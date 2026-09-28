import { supabaseAdmin } from "../../config/supabase.js";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/httpError.js";
import { logger } from "../../lib/logger.js";
import { background } from "../../lib/background.js";
import { getSetting } from "../settings/settings.service.js";
import { sendTemplatedEmail, storeLinkVariables } from "../email/email.service.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Customer returns and exchanges, following the published Returns policy:
 *   • requested within `order.return_window_days` (default 7) of delivery, while
 *     `order.allow_returns` is on;
 *   • personalised / made-to-order / custom pieces only when they arrived damaged, defective
 *     or wrong — anything else can be returned for any listed reason;
 *   • one open request per order at a time.
 *
 * Flow: requested → approved → received → refunded (return) / exchanged (exchange).
 * The admin can reject at requested / approved; the customer can cancel until it's received.
 * Money moves through the normal refund action — issuing a refund on the order settles an
 * approved or received return automatically (see settleReturnWithRefund).
 */

export const RETURN_REASONS = ["damaged", "defective", "wrong_item", "not_as_described", "changed_mind", "size_or_fit", "other"] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];
/** Reasons that make even a personalised piece returnable. */
const FAULT_REASONS: ReturnReason[] = ["damaged", "defective", "wrong_item"];

export const REASON_LABELS: Record<ReturnReason, string> = {
  damaged: "Arrived damaged",
  defective: "Defective or poorly made",
  wrong_item: "Wrong item sent",
  not_as_described: "Not as described",
  changed_mind: "Changed my mind",
  size_or_fit: "Size or fit",
  other: "Something else",
};

export const OPEN_STATUSES = ["requested", "approved", "received"];
type Status = "requested" | "approved" | "rejected" | "received" | "refunded" | "exchanged" | "cancelled";

/** Which admin moves are allowed from each status. refunded is reached by issuing a refund. */
export const ADMIN_TRANSITIONS: Record<Status, Status[]> = {
  requested: ["approved", "rejected"],
  approved: ["received", "rejected"],
  received: ["exchanged"],
  rejected: [],
  refunded: [],
  exchanged: [],
  cancelled: [],
};

const STATUS_LABELS: Record<Status, string> = {
  requested: "Requested",
  approved: "Approved",
  rejected: "Declined",
  received: "Received",
  refunded: "Refunded",
  exchanged: "Exchanged",
  cancelled: "Cancelled",
};

export interface ReturnableItem {
  orderItemId: string;
  name: string;
  image: string | null;
  quantity: number;
  /** Units still returnable (ordered − already returned). */
  available: number;
  /** Personalised / made to order — returnable only when damaged, defective or wrong. */
  faultOnly: boolean;
}

export interface ReturnEligibility {
  eligible: boolean;
  /** Why not, in the customer's language. */
  reason?: string;
  deadline: string | null;
  items: ReturnableItem[];
}

/** When the order was delivered: its latest "delivered" history entry, else its last update. */
function deliveredAt(order: any): Date | null {
  const entries = (order.order_status_history ?? []).filter((h: any) => h.status === "delivered");
  const latest = entries.map((h: any) => h.created_at as string).sort().at(-1);
  const when = latest ?? (order.status === "delivered" ? order.updated_at : null);
  return when ? new Date(when) : null;
}

/**
 * Loads what's needed to decide eligibility: the order's items with each product's type, and
 * earlier requests (to count units already on their way back).
 */
export async function loadReturnContext(orderId: string) {
  const [{ data: items }, { data: requests }] = await Promise.all([
    supabaseAdmin.from("order_items").select("id, product_id, product_name_snapshot, product_image_snapshot, quantity, custom_text, customizations, products(product_type)").eq("order_id", orderId),
    supabaseAdmin.from("return_requests").select("*").eq("order_id", orderId).order("created_at", { ascending: false }),
  ]);
  return { items: items ?? [], requests: requests ?? [] };
}

export async function returnEligibility(order: any, ctx?: Awaited<ReturnType<typeof loadReturnContext>>): Promise<ReturnEligibility> {
  const { items, requests } = ctx ?? (await loadReturnContext(order.id));
  const [allowed, windowDays] = await Promise.all([getSetting<boolean>("order.allow_returns"), getSetting<number>("order.return_window_days")]);

  // Units already coming back or returned in earlier requests
  const returned = new Map<string, number>();
  for (const r of requests.filter((x: any) => !["rejected", "cancelled"].includes(x.status))) {
    for (const i of r.items ?? []) returned.set(i.orderItemId, (returned.get(i.orderItemId) ?? 0) + Number(i.quantity));
  }
  const lines: ReturnableItem[] = items.map((i: any) => {
    const type = i.products?.product_type;
    const personalised = Boolean(i.custom_text) || (Array.isArray(i.customizations) && i.customizations.length > 0);
    return {
      orderItemId: i.id,
      name: i.product_name_snapshot,
      image: i.product_image_snapshot ?? null,
      quantity: i.quantity,
      available: Math.max(0, i.quantity - (returned.get(i.id) ?? 0)),
      faultOnly: personalised || type === "made_to_order" || type === "custom_order",
    };
  });

  const delivered = deliveredAt(order);
  const deadline = delivered ? new Date(delivered.getTime() + Number(windowDays ?? 7) * 86_400_000) : null;
  const no = (reason: string): ReturnEligibility => ({ eligible: false, reason, deadline: deadline?.toISOString() ?? null, items: lines });

  if (!allowed) return no("Returns aren’t available online right now — please contact us.");
  if (order.status !== "delivered") return no("Returns open once your order has been delivered.");
  if (!["paid", "partially_refunded"].includes(order.payment_status)) return no("This order has already been refunded.");
  if (requests.some((r: any) => OPEN_STATUSES.includes(r.status))) return no("There’s already a return in progress for this order.");
  if (!deadline || deadline.getTime() < Date.now()) return no(`The ${windowDays ?? 7}-day return window for this order has closed.`);
  if (lines.every((l) => l.available === 0)) return no("Everything in this order has already been returned.");
  return { eligible: true, deadline: deadline.toISOString(), items: lines };
}

export interface CreateReturnInput {
  type: "return" | "exchange";
  reason: ReturnReason;
  details?: string;
  items: { orderItemId: string; quantity: number }[];
}

export async function createReturnRequest(order: any, customerId: string, input: CreateReturnInput) {
  const ctx = await loadReturnContext(order.id);
  const eligibility = await returnEligibility(order, ctx);
  if (!eligibility.eligible) throw HttpError.badRequest(eligibility.reason ?? "This order can’t be returned");

  const byId = new Map(eligibility.items.map((i) => [i.orderItemId, i]));
  const merged = new Map<string, number>();
  for (const i of input.items) merged.set(i.orderItemId, (merged.get(i.orderItemId) ?? 0) + i.quantity);
  if (merged.size === 0) throw HttpError.badRequest("Choose at least one item to return");
  for (const [id, qty] of merged) {
    const line = byId.get(id);
    if (!line) throw HttpError.badRequest("One of the items isn’t part of this order");
    if (qty < 1 || qty > line.available) throw HttpError.badRequest(`You can return up to ${line.available} of “${line.name}”`);
    if (line.faultOnly && !FAULT_REASONS.includes(input.reason)) {
      throw HttpError.badRequest(`“${line.name}” was made or personalised for you, so it can only be returned if it arrived damaged, defective or wrong.`);
    }
  }
  if (input.reason === "other" && !input.details?.trim()) throw HttpError.badRequest("Please tell us a little about the problem");

  const { data, error } = await supabaseAdmin
    .from("return_requests")
    .insert({
      order_id: order.id,
      customer_id: customerId,
      type: input.type,
      reason: input.reason,
      details: input.details?.trim() || null,
      items: [...merged].map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
      status: "requested",
    })
    .select("*")
    .single();
  // The partial unique index is the last word on "one open request per order"
  if (error?.code === "23505") throw HttpError.conflict("There’s already a return in progress for this order");
  if (error || !data) throw HttpError.internal(error?.message ?? "Could not create the return request");

  await supabaseAdmin.from("order_status_history").insert({
    order_id: order.id,
    status: order.status,
    note: `${input.type === "exchange" ? "Exchange" : "Return"} requested by customer — ${REASON_LABELS[input.reason]}`,
  });

  notify(data, order, ctx.items, "requested");
  notifyAdmin(data, order, ctx.items);
  return data;
}

/** Customer withdraws their own request (until the parcel has been received). */
export async function cancelReturnRequest(requestId: string, customerId: string) {
  const { data, error } = await supabaseAdmin
    .from("return_requests")
    .update({ status: "cancelled", resolved_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("customer_id", customerId)
    .in("status", ["requested", "approved"])
    .select("*");
  if (error) throw HttpError.internal(error.message);
  if (!data?.length) throw HttpError.badRequest("This return can no longer be cancelled");
  return data[0];
}

/** An admin moves a request along; the order and customer are kept in the loop. */
export async function updateReturnStatus(requestId: string, next: Status, adminId: string, adminNote?: string) {
  const { data: current } = await supabaseAdmin.from("return_requests").select("*").eq("id", requestId).maybeSingle();
  if (!current) throw HttpError.notFound("Return request not found");
  if (!ADMIN_TRANSITIONS[current.status as Status]?.includes(next)) {
    throw HttpError.badRequest(`A ${STATUS_LABELS[current.status as Status].toLowerCase()} request can’t be marked ${STATUS_LABELS[next].toLowerCase()}`);
  }
  if (next === "exchanged" && current.type !== "exchange") throw HttpError.badRequest("Refund this return from the order instead");
  if (next === "rejected" && !adminNote?.trim()) throw HttpError.badRequest("Please give the customer a reason");

  const closing = ["rejected", "exchanged"].includes(next);
  const { data: updated, error } = await supabaseAdmin
    .from("return_requests")
    .update({
      status: next,
      admin_note: adminNote?.trim() || current.admin_note,
      ...(closing ? { resolved_at: new Date().toISOString(), resolved_by: adminId } : {}),
    })
    .eq("id", requestId)
    .eq("status", current.status)
    .select("*");
  if (error) throw HttpError.internal(error.message);
  if (!updated?.length) throw HttpError.conflict("This request was just updated — please refresh");

  const { data: order } = await supabaseAdmin.from("orders").select("*").eq("id", current.order_id).single();
  await supabaseAdmin.from("order_status_history").insert({
    order_id: current.order_id,
    status: order?.status ?? "delivered",
    note: `${current.type === "exchange" ? "Exchange" : "Return"} ${STATUS_LABELS[next].toLowerCase()}${adminNote?.trim() ? ` — ${adminNote.trim()}` : ""}`,
    changed_by: adminId,
  });
  if (order) {
    const { items } = await loadReturnContext(order.id);
    notify(updated[0], order, items, next);
  }
  return updated[0];
}

/**
 * Called after a refund is recorded on an order: an approved or received return on that order
 * is settled by it (status → refunded, linked to the refund).
 */
export async function settleReturnWithRefund(orderId: string, refundId: string | null, adminId: string) {
  const { data } = await supabaseAdmin
    .from("return_requests")
    .update({ status: "refunded", refund_id: refundId, resolved_at: new Date().toISOString(), resolved_by: adminId })
    .eq("order_id", orderId)
    .eq("type", "return")
    .in("status", ["approved", "received"])
    .select("id");
  return (data ?? []).length > 0;
}

// ---- notifications ----

const COPY: Partial<Record<Status, (type: string) => { label: string; headline: string; message: string; subject: string }>> = {
  requested: (t) => ({
    label: `${t} requested`,
    headline: `We’ve got your ${t} request`,
    message: "thanks for letting us know. We’ll review it within 1–2 business days and email you the next steps.",
    subject: `We’ve received your ${t} request for order {{order_number}}`,
  }),
  approved: (t) => ({
    label: `${t} approved`,
    headline: `Your ${t} is approved`,
    message: "please pack the items securely (original packaging if you still have it) and send them back to us. We’ll let you know as soon as they arrive.",
    subject: `Your ${t} for order {{order_number}} is approved`,
  }),
  rejected: (t) => ({
    label: `${t} update`,
    headline: `We couldn’t approve this ${t}`,
    message: "we’ve looked at your request carefully, and unfortunately we can’t accept it this time. The note below explains why — reply to this email if you’d like to talk it through.",
    subject: `An update on your ${t} request for order {{order_number}}`,
  }),
  received: (t) => ({
    label: `${t} received`,
    headline: "Your parcel is back with us",
    message: t === "exchange" ? "we’ve received your items and are preparing your replacement." : "we’ve received your items. Once we’ve checked them, your refund will be processed and you’ll get a confirmation email.",
    subject: `We’ve received your ${t} for order {{order_number}}`,
  }),
  exchanged: () => ({
    label: "Exchange complete",
    headline: "Your replacement is on its way",
    message: "your exchange is complete and the replacement has been sent. We hope you love it!",
    subject: "Your exchange for order {{order_number}} is complete",
  }),
};

function itemsSummary(request: any, items: any[]) {
  const names = new Map(items.map((i: any) => [i.id, i.product_name_snapshot]));
  return (request.items ?? []).map((i: any) => `${names.get(i.orderItemId) ?? "Item"} × ${i.quantity}`).join(", ");
}

function notify(request: any, order: any, items: any[], status: Status) {
  const copy = COPY[status]?.(request.type);
  const to = order.guest_email ?? order.shipping_address?.email;
  if (!copy || !to) return;
  const name = order.shipping_address?.firstName ? `${order.shipping_address.firstName} ${order.shipping_address.lastName ?? ""}`.trim() : "there";
  background(
    sendTemplatedEmail({
      type: "return_update",
      to,
      variables: {
        customer_name: name,
        order_number: order.order_number,
        return_subject: copy.subject.replace("{{order_number}}", order.order_number),
        return_label: copy.label.charAt(0).toUpperCase() + copy.label.slice(1),
        return_headline: copy.headline,
        return_message: copy.message,
        return_type: request.type === "exchange" ? "Exchange" : "Return",
        return_items: itemsSummary(request, items),
        return_status: STATUS_LABELS[status],
        admin_note: request.admin_note ?? "",
        order_url: `${env.FRONTEND_URL}/account/orders/${order.id}`,
        ...storeLinkVariables(),
      },
      relatedOrderId: order.id,
    }).catch((err) => logger.error({ err, requestId: request.id }, "return_update email failed"))
  );
}

function notifyAdmin(request: any, order: any, items: any[]) {
  if (!env.ADMIN_NOTIFICATION_EMAIL) return;
  const name = `${order.shipping_address?.firstName ?? ""} ${order.shipping_address?.lastName ?? ""}`.trim() || "A customer";
  const escape = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
  background(
    sendTemplatedEmail({
      type: "admin_new_enquiry",
      to: env.ADMIN_NOTIFICATION_EMAIL,
      variables: { customer_name: name, customer_email: order.guest_email ?? order.shipping_address?.email ?? "no email on file", ...storeLinkVariables() },
      rawVariables: {
        enquiry_message:
          `<strong>${request.type === "exchange" ? "Exchange" : "Return"} requested for order ${escape(order.order_number)}</strong><br/><br/>` +
          `Reason: ${REASON_LABELS[request.reason as ReturnReason]}<br/>Items: ${escape(itemsSummary(request, items))}` +
          (request.details ? `<br/><br/>${escape(request.details)}` : "") +
          `<br/><br/>Review it in Admin → Returns.`,
      },
      relatedOrderId: order.id,
    }).catch((err) => logger.error({ err, requestId: request.id }, "admin return notification failed"))
  );
}

export function toReturnDTO(r: any, items: any[] = []) {
  const byId = new Map(items.map((i: any) => [i.id, i]));
  return {
    id: r.id,
    orderId: r.order_id,
    type: r.type,
    status: r.status,
    statusLabel: STATUS_LABELS[r.status as Status] ?? r.status,
    reason: r.reason,
    reasonLabel: REASON_LABELS[r.reason as ReturnReason] ?? r.reason,
    details: r.details,
    adminNote: r.admin_note,
    refundId: r.refund_id,
    items: (r.items ?? []).map((i: any) => ({
      orderItemId: i.orderItemId,
      quantity: i.quantity,
      name: byId.get(i.orderItemId)?.product_name_snapshot ?? "Item",
      image: byId.get(i.orderItemId)?.product_image_snapshot ?? null,
    })),
    // "Exchanged" only closes exchanges — a return is settled by refunding the order
    allowedNext: (ADMIN_TRANSITIONS[r.status as Status] ?? []).filter((st) => st !== "exchanged" || r.type === "exchange"),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at,
  };
}
