import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../../config/supabase.js";
import { authenticate } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { HttpError } from "../../lib/httpError.js";
import { PRODUCT_SELECT, toProductDTO } from "../catalog/serializers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const meRouter = Router();
meRouter.use(authenticate);

// ---- Profile ----

meRouter.get("/", async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("customer_profiles")
      .select("*")
      .eq("id", req.user!.id)
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    res.json(
      data && {
        id: data.id,
        email: data.email,
        phone: data.phone,
        firstName: data.first_name,
        lastName: data.last_name,
        marketingOptIn: data.marketing_opt_in,
      }
    );
  } catch (err) {
    next(err);
  }
});

const updateProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  marketingOptIn: z.boolean().optional(),
});

meRouter.patch("/", validate(updateProfileSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof updateProfileSchema>;
    const { data, error } = await supabaseAdmin
      .from("customer_profiles")
      .update({ first_name: body.firstName, last_name: body.lastName, marketing_opt_in: body.marketingOptIn })
      .eq("id", req.user!.id)
      .select("*")
      .single();
    if (error) throw HttpError.internal(error.message);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ---- Addresses ----

meRouter.get("/addresses", async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("addresses")
      .select("*")
      .eq("customer_id", req.user!.id)
      .order("is_default", { ascending: false });
    if (error) throw HttpError.internal(error.message);
    res.json(data ?? []);
  } catch (err) {
    next(err);
  }
});

const addressSchema = z.object({
  label: z.string().optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().min(6),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().min(4),
  isDefault: z.boolean().optional(),
});

meRouter.post("/addresses", validate(addressSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof addressSchema>;
    if (body.isDefault) {
      await supabaseAdmin.from("addresses").update({ is_default: false }).eq("customer_id", req.user!.id);
    }
    const { data, error } = await supabaseAdmin
      .from("addresses")
      .insert({
        customer_id: req.user!.id,
        label: body.label,
        first_name: body.firstName,
        last_name: body.lastName,
        phone: body.phone,
        address_line1: body.addressLine1,
        address_line2: body.addressLine2,
        city: body.city,
        state: body.state,
        pincode: body.pincode,
        is_default: body.isDefault ?? false,
      })
      .select("*")
      .single();
    if (error) throw HttpError.internal(error.message);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

meRouter.patch("/addresses/:id", validate(addressSchema.partial()), async (req, res, next) => {
  try {
    const body = req.body as Partial<z.infer<typeof addressSchema>>;
    if (body.isDefault) {
      await supabaseAdmin.from("addresses").update({ is_default: false }).eq("customer_id", req.user!.id);
    }
    const { data, error } = await supabaseAdmin
      .from("addresses")
      .update({
        label: body.label,
        first_name: body.firstName,
        last_name: body.lastName,
        phone: body.phone,
        address_line1: body.addressLine1,
        address_line2: body.addressLine2,
        city: body.city,
        state: body.state,
        pincode: body.pincode,
        is_default: body.isDefault,
      })
      .eq("id", req.params.id)
      .eq("customer_id", req.user!.id)
      .select("*")
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Address not found");
    res.json(data);
  } catch (err) {
    next(err);
  }
});

meRouter.delete("/addresses/:id", async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from("addresses")
      .delete()
      .eq("id", req.params.id)
      .eq("customer_id", req.user!.id);
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Orders (history) ----

function toOrderSummaryDTO(o: any) {
  return {
    id: o.id,
    orderNumber: o.order_number,
    status: o.status,
    paymentStatus: o.payment_status,
    total: Number(o.total),
    itemCount: (o.order_items ?? []).reduce((s: number, i: any) => s + i.quantity, 0),
    placedAt: o.placed_at,
    createdAt: o.created_at,
  };
}

function toOrderDetailDTO(o: any) {
  return {
    ...toOrderSummaryDTO(o),
    subtotal: Number(o.subtotal),
    discountAmount: Number(o.discount_amount),
    shippingCost: Number(o.shipping_cost),
    giftWrapCost: Number(o.gift_wrap_cost),
    shippingAddress: o.shipping_address,
    shippingMethod: o.shipping_method,
    paymentMethod: o.payment_method,
    giftWrap: o.gift_wrap,
    giftMessage: o.gift_message,
    items: (o.order_items ?? []).map((i: any) => ({
      id: i.id,
      productId: i.product_id,
      name: i.product_name_snapshot,
      image: i.product_image_snapshot,
      unitPrice: Number(i.unit_price_snapshot),
      quantity: i.quantity,
      lineTotal: Number(i.line_total),
      selectedColor: i.selected_color_hex,
      customText: i.custom_text,
    })),
    statusHistory: (o.order_status_history ?? [])
      .slice()
      .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((h: any) => ({ status: h.status, note: h.note, at: h.created_at })),
  };
}

meRouter.get("/orders", async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("*, order_items(*)")
      .eq("customer_id", req.user!.id)
      .order("created_at", { ascending: false });
    if (error) throw HttpError.internal(error.message);
    res.json((data ?? []).map(toOrderSummaryDTO));
  } catch (err) {
    next(err);
  }
});

meRouter.get("/orders/:id", async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("*, order_items(*), order_status_history(*)")
      .eq("id", req.params.id)
      .eq("customer_id", req.user!.id)
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Order not found");
    res.json(toOrderDetailDTO(data));
  } catch (err) {
    next(err);
  }
});

// ---- Wishlist ----

meRouter.get("/wishlist", async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("wishlist_items")
      .select(`product_id, products(${PRODUCT_SELECT})`)
      .eq("customer_id", req.user!.id);
    if (error) throw HttpError.internal(error.message);
    res.json((data ?? []).map((w: any) => (w.products ? toProductDTO(w.products) : null)).filter(Boolean));
  } catch (err) {
    next(err);
  }
});

meRouter.post("/wishlist/:productId", async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from("wishlist_items")
      .upsert(
        { customer_id: req.user!.id, product_id: req.params.productId },
        { onConflict: "customer_id,product_id" }
      );
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

meRouter.delete("/wishlist/:productId", async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from("wishlist_items")
      .delete()
      .eq("customer_id", req.user!.id)
      .eq("product_id", req.params.productId);
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Cart (server sync for logged-in users; guests stay on the existing localStorage cart) ----

/** Resolves stored {customizationId, valueId, textValue} selections against the
 * product's current groups/values so the cart can display labels, not raw IDs. */
function resolveCartCustomizations(product: any, selections: any[]) {
  if (!selections?.length) return [];
  const groups = product.customizations ?? [];
  return selections
    .map((s: any) => {
      const group = groups.find((g: any) => g.id === s.customizationId);
      if (!group) return null;
      const value = group.values.find((v: any) => v.id === s.valueId);
      return {
        customizationId: group.id,
        label: group.label,
        valueLabel: value?.label,
        textValue: s.textValue,
        priceAdjustment: value?.priceAdjustment ?? 0,
      };
    })
    .filter(Boolean);
}

function toCartItemDTO(row: any) {
  const product = row.products ? toProductDTO(row.products) : null;
  return {
    id: row.id,
    product,
    quantity: row.quantity,
    selectedColor: row.selected_color_hex || undefined,
    customText: row.custom_text || undefined,
    customizations: product ? resolveCartCustomizations(product, row.customizations ?? []) : [],
  };
}

meRouter.get("/cart", async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("cart_items")
      .select(`*, products(${PRODUCT_SELECT})`)
      .eq("customer_id", req.user!.id);
    if (error) throw HttpError.internal(error.message);
    res.json((data ?? []).map(toCartItemDTO).filter((c) => c.product));
  } catch (err) {
    next(err);
  }
});

const cartSyncSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().min(1).max(20),
      selectedColor: z.string().optional(),
      customText: z.string().max(200).optional(),
      customizations: z
        .array(
          z.object({
            customizationId: z.string().uuid(),
            valueId: z.string().uuid().optional(),
            textValue: z.string().max(1000).optional(),
          })
        )
        .optional(),
    })
  ),
});

// Merges the client's (possibly guest) cart into the server cart — additive union keyed on
// product+color+customText, mirroring the key logic in the frontend's Zustand cart store.
meRouter.put("/cart", validate(cartSyncSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof cartSyncSchema>;

    for (const item of body.items) {
      const colorKey = item.selectedColor ?? "";
      const textKey = item.customText ?? "";
      const customizations = item.customizations ?? [];

      const { data: existing } = await supabaseAdmin
        .from("cart_items")
        .select("id, quantity")
        .eq("customer_id", req.user!.id)
        .eq("product_id", item.productId)
        .eq("selected_color_hex", colorKey)
        .eq("custom_text", textKey)
        .eq("customizations", JSON.stringify(customizations))
        .maybeSingle();

      if (existing) {
        await supabaseAdmin
          .from("cart_items")
          .update({ quantity: existing.quantity + item.quantity })
          .eq("id", existing.id);
      } else {
        await supabaseAdmin.from("cart_items").insert({
          customer_id: req.user!.id,
          product_id: item.productId,
          quantity: item.quantity,
          selected_color_hex: colorKey,
          custom_text: textKey,
          customizations,
        });
      }
    }

    const { data, error } = await supabaseAdmin
      .from("cart_items")
      .select(`*, products(${PRODUCT_SELECT})`)
      .eq("customer_id", req.user!.id);
    if (error) throw HttpError.internal(error.message);
    res.json((data ?? []).map(toCartItemDTO).filter((c) => c.product));
  } catch (err) {
    next(err);
  }
});

meRouter.delete("/cart/:itemId", async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from("cart_items")
      .delete()
      .eq("id", req.params.itemId)
      .eq("customer_id", req.user!.id);
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

meRouter.delete("/cart", async (req, res, next) => {
  try {
    await supabaseAdmin.from("cart_items").delete().eq("customer_id", req.user!.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
