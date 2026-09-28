import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { auditWrites } from "../rbac/audit.service.js";
import { toReturnDTO, updateReturnStatus } from "./returns.service.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const adminReturnsRouter = Router();
adminReturnsRouter.use(authenticate, requireAdmin, auditWrites("return_requests", "RETURN"));

const listSchema = z.object({
  status: z.enum(["open", "requested", "approved", "received", "rejected", "refunded", "exchanged", "cancelled", "all"]).default("open"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

adminReturnsRouter.get("/", requirePermission("orders.view"), async (req, res, next) => {
  try {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) throw HttpError.badRequest("Invalid filters");
    const f = parsed.data;
    let query = supabaseAdmin
      .from("return_requests")
      .select("*, orders(id, order_number, status, payment_method, payment_status, total, refunded_amount, shipping_address, guest_email, order_items(id, product_name_snapshot, product_image_snapshot))", { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true });
    if (f.status === "open") query = query.in("status", ["requested", "approved", "received"]);
    else if (f.status !== "all") query = query.eq("status", f.status);
    const from = (f.page - 1) * f.limit;
    const [{ data, error, count }, { count: openCount }] = await Promise.all([
      query.range(from, from + f.limit - 1),
      supabaseAdmin.from("return_requests").select("id", { count: "exact", head: true }).in("status", ["requested", "approved", "received"]),
    ]);
    if (error) throw HttpError.internal(error.message);
    res.json({
      items: (data ?? []).map((r: any) => {
        const o = r.orders ?? {};
        const addr = o.shipping_address ?? {};
        return {
          ...toReturnDTO(r, o.order_items ?? []),
          order: {
            id: o.id,
            orderNumber: o.order_number,
            status: o.status,
            paymentMethod: o.payment_method,
            paymentStatus: o.payment_status,
            total: Number(o.total ?? 0),
            refundedAmount: Number(o.refunded_amount ?? 0),
            customerName: [addr.firstName, addr.lastName].filter(Boolean).join(" ") || null,
            customerEmail: o.guest_email ?? addr.email ?? null,
          },
        };
      }),
      total: count ?? 0,
      openCount: openCount ?? 0,
      page: f.page,
      limit: f.limit,
    });
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  status: z.enum(["approved", "rejected", "received", "exchanged"]),
  adminNote: z.string().trim().max(1000).optional(),
});

adminReturnsRouter.patch("/:id", requirePermission("orders.update"), validate(updateSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof updateSchema>;
    const updated = await updateReturnStatus(req.params.id, body.status, req.admin!.id, body.adminNote);
    res.json(toReturnDTO(updated));
  } catch (err) {
    next(err);
  }
});
