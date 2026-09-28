import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { sendTemplatedEmail, storeLinkVariables } from "../email/email.service.js";
import { z } from "zod";
import { logAudit } from "../rbac/audit.service.js";
import { fetchAll, resolveRange, COLLECTED_STATUSES } from "../analytics/analytics.service.js";
import { searchTokens, toCsv } from "../../lib/csv.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const adminCustomersRouter = Router();
adminCustomersRouter.use(authenticate, requireAdmin);

// ---- List: search, filters, sorting and paging run in the database, over the
// admin_customer_stats view (one row per customer with order count and net spend) ----

const CUSTOMER_SORTS = {
  joined: "created_at",
  name: "first_name",
  orders: "order_count",
  spent: "total_spent",
  lastOrder: "last_order_at",
} as const;

const customerListSchema = z.object({
  q: z.string().max(200).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  minOrders: z.coerce.number().int().min(0).optional(),
  minSpent: z.coerce.number().min(0).optional(),
  maxSpent: z.coerce.number().min(0).optional(),
  sort: z.enum(Object.keys(CUSTOMER_SORTS) as [keyof typeof CUSTOMER_SORTS, ...(keyof typeof CUSTOMER_SORTS)[]]).default("joined"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
type CustomerListQuery = z.infer<typeof customerListSchema>;

function parseCustomerQuery(query: unknown): CustomerListQuery {
  const parsed = customerListSchema.safeParse(query);
  if (!parsed.success) throw HttpError.badRequest("Invalid customer filters", parsed.error.flatten().fieldErrors);
  return parsed.data;
}

/**
 * The date filter needs the store timezone (async), so it's resolved once up front — the
 * query builder itself is thenable, so it must never be returned from an async function
 * (awaiting it would run the query).
 */
async function dateBounds(f: { from?: string; to?: string }) {
  if (!f.from && !f.to) return null;
  const range = await resolveRange({ from: f.from, to: f.to });
  return { since: range.since, until: range.until };
}

function applyCustomerFilters(query: any, f: CustomerListQuery, dates: { since: string; until: string } | null) {
  if (f.minOrders !== undefined) query = query.gte("order_count", f.minOrders);
  if (f.minSpent !== undefined) query = query.gte("total_spent", f.minSpent);
  if (f.maxSpent !== undefined) query = query.lte("total_spent", f.maxSpent);
  if (dates) query = query.gte("created_at", dates.since).lte("created_at", dates.until);
  for (const t of searchTokens(f.q)) {
    const like = `%${t}%`;
    query = query.or([`first_name.ilike.${like}`, `last_name.ilike.${like}`, `email.ilike.${like}`, `phone.ilike.${like}`].join(","));
  }
  return query;
}

const toCustomerSummary = (c: any) => ({
  id: c.id,
  email: c.email,
  phone: c.phone,
  firstName: c.first_name,
  lastName: c.last_name,
  createdAt: c.created_at,
  orderCount: Number(c.order_count ?? 0),
  totalSpent: Number(c.total_spent ?? 0),
  lastOrderAt: c.last_order_at ?? null,
  marketingOptIn: Boolean(c.marketing_opt_in),
});

adminCustomersRouter.get("/", requirePermission("customers.view"), async (req, res, next) => {
  try {
    const f = parseCustomerQuery(req.query);
    const dates = await dateBounds(f);
    const from = (f.page - 1) * f.limit;
    const pageQuery = applyCustomerFilters(supabaseAdmin.from("admin_customer_stats").select("*", { count: "exact" }), f, dates)
      .order(CUSTOMER_SORTS[f.sort], { ascending: f.dir === "asc", nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, from + f.limit - 1);

    const [{ data, error, count }, totalsRows, { data: biggest }] = await Promise.all([
      pageQuery,
      fetchAll<any>((a, b) =>
        applyCustomerFilters(supabaseAdmin.from("admin_customer_stats").select("id, order_count, total_spent"), f, dates).order("id", { ascending: true }).range(a, b)
      ),
      supabaseAdmin.from("admin_customer_stats").select("total_spent").order("total_spent", { ascending: false }).limit(1),
    ]);
    if (error) throw HttpError.internal(error.message);

    const orders = totalsRows.reduce((s, c) => s + Number(c.order_count ?? 0), 0);
    res.json({
      items: (data ?? []).map(toCustomerSummary),
      total: count ?? 0,
      page: f.page,
      limit: f.limit,
      stats: {
        totalSpent: Math.round(totalsRows.reduce((s, c) => s + Number(c.total_spent ?? 0), 0) * 100) / 100,
        avgOrders: totalsRows.length ? orders / totalsRows.length : 0,
        loyal: totalsRows.filter((c) => Number(c.order_count ?? 0) >= 5).length,
        maxSpent: Number(biggest?.[0]?.total_spent ?? 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

adminCustomersRouter.get("/export", requirePermission("customers.export"), async (req, res, next) => {
  try {
    const f = parseCustomerQuery(req.query);
    const dates = await dateBounds(f);
    const rows = await fetchAll<any>((a, b) =>
      applyCustomerFilters(supabaseAdmin.from("admin_customer_stats").select("*"), f, dates)
        .order(CUSTOMER_SORTS[f.sort], { ascending: f.dir === "asc", nullsFirst: false })
        .order("id", { ascending: true })
        .range(a, b)
    );
    const csv = toCsv<any>(
      [
        ["First name", (c) => c.first_name],
        ["Last name", (c) => c.last_name],
        ["Email", (c) => c.email],
        ["Phone", (c) => c.phone],
        ["Joined", (c) => c.created_at],
        ["Paid orders", (c) => c.order_count],
        ["Net spent", (c) => c.total_spent],
        ["Last order", (c) => c.last_order_at],
        ["Marketing opt-in", (c) => (c.marketing_opt_in ? "yes" : "no")],
      ],
      rows
    );
    await logAudit({
      userId: req.admin!.id,
      action: "DATA_EXPORTED",
      resource: "customers",
      permission: "customers.export",
      metadata: { rows: rows.length, filters: { ...f, page: undefined, limit: undefined } },
      req,
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="suthrayaa-customers-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

adminCustomersRouter.get("/:id", requirePermission("customers.view"), async (req, res, next) => {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from("customer_profiles")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!profile) throw HttpError.notFound("Customer not found");

    const { data: orders } = await supabaseAdmin
      .from("orders")
      .select("id, order_number, status, payment_status, payment_method, total, refunded_amount, tracking_number, placed_at, created_at, order_items(quantity)")
      .eq("customer_id", req.params.id)
      .order("created_at", { ascending: false });
    const { data: addresses } = await supabaseAdmin.from("addresses").select("*").eq("customer_id", req.params.id);

    const allOrders = orders ?? [];
    // Same definition as analytics: money collected, net of refunds
    const paidOrders = allOrders.filter((o: any) => COLLECTED_STATUSES.includes(o.payment_status));
    const totalSpent = paidOrders.reduce((s: number, o: any) => s + Number(o.total) - Number(o.refunded_amount ?? 0), 0);
    const failedOrders = allOrders.filter((o: any) => o.payment_status === "failed").length;
    const refundedOrders = allOrders.filter((o: any) => o.payment_status === "refunded" || o.payment_status === "partially_refunded").length;

    res.json({
      id: profile.id,
      email: profile.email,
      phone: profile.phone,
      firstName: profile.first_name,
      lastName: profile.last_name,
      marketingOptIn: profile.marketing_opt_in,
      createdAt: profile.created_at,
      stats: {
        orderCount: allOrders.length,
        paidOrderCount: paidOrders.length,
        failedOrderCount: failedOrders,
        refundedOrderCount: refundedOrders,
        totalSpent,
        avgOrderValue: paidOrders.length ? totalSpent / paidOrders.length : 0,
        lastOrderAt: allOrders[0]?.created_at ?? null,
      },
      orders: allOrders.map((o: any) => ({
        id: o.id,
        orderNumber: o.order_number,
        status: o.status,
        paymentStatus: o.payment_status,
        paymentMethod: o.payment_method,
        total: Number(o.total),
        itemCount: (o.order_items ?? []).reduce((s: number, i: any) => s + i.quantity, 0),
        trackingNumber: o.tracking_number,
        placedAt: o.placed_at,
        createdAt: o.created_at,
      })),
      addresses: addresses ?? [],
    });
  } catch (err) {
    next(err);
  }
});

adminCustomersRouter.post("/:id/send-welcome-email", requirePermission("customers.update"), async (req, res, next) => {
  try {
    const { data: profile } = await supabaseAdmin.from("customer_profiles").select("*").eq("id", req.params.id).maybeSingle();
    if (!profile) throw HttpError.notFound("Customer not found");
    if (!profile.email) throw HttpError.badRequest("This customer has no email address on file");

    await sendTemplatedEmail({
      type: "customer_welcome",
      to: profile.email,
      variables: {
        customer_name: `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() || "there",
        store_name: "Suthrayaa",
        ...storeLinkVariables(),
      },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminCustomersRouter.get("/:id/emails", requirePermission("customers.view"), async (req, res, next) => {
  try {
    const { data: profile } = await supabaseAdmin.from("customer_profiles").select("email").eq("id", req.params.id).maybeSingle();
    if (!profile) throw HttpError.notFound("Customer not found");

    const { data: orders } = await supabaseAdmin.from("orders").select("id").eq("customer_id", req.params.id);
    const orderIds = (orders ?? []).map((o: any) => o.id);

    let query = supabaseAdmin.from("email_logs").select("*").order("sent_at", { ascending: false });
    if (orderIds.length > 0 && profile.email) {
      query = query.or(`order_id.in.(${orderIds.join(",")}),recipient.eq."${String(profile.email).replace(/"/g, "")}"`);
    } else if (orderIds.length > 0) {
      query = query.in("order_id", orderIds);
    } else if (profile.email) {
      query = query.eq("recipient", profile.email);
    } else {
      res.json([]);
      return;
    }

    const { data, error } = await query;
    if (error) throw HttpError.internal(error.message);

    res.json(
      (data ?? []).map((l: any) => ({
        id: l.id,
        type: l.type,
        recipient: l.recipient,
        orderId: l.order_id,
        subject: l.subject,
        status: l.status,
        errorMessage: l.error_message,
        sentAt: l.sent_at,
      }))
    );
  } catch (err) {
    next(err);
  }
});
