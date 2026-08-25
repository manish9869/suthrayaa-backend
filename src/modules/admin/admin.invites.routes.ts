import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { validate } from "../../middleware/validate.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { logAudit } from "../rbac/audit.service.js";

/**
 * Public, unauthenticated by design — this is how a brand-new admin registers. There's no
 * account to authenticate as yet; the single-use, expiring, hashed invite token IS the
 * credential. Mounted directly in app.ts, before the authenticate/requireAdmin gate that
 * every other /api/admin/* router sits behind.
 */
export const adminInvitesRouter = Router();

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function loadValidInvite(token: string) {
  const { data, error } = await supabaseAdmin
    .from("admin_invites")
    .select("id, email, role_ids, expires_at, used_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (error) throw HttpError.internal(error.message);
  if (!data || data.used_at || new Date(data.expires_at).getTime() < Date.now()) return null;
  return data;
}

adminInvitesRouter.get("/:token", async (req, res, next) => {
  try {
    const invite = await loadValidInvite(req.params.token);
    if (!invite) throw HttpError.notFound("This invite is no longer valid.");

    const { data: roles } = await supabaseAdmin.from("roles").select("name").in("id", invite.role_ids);
    res.json({ email: invite.email, roleNames: (roles ?? []).map((r) => r.name) });
  } catch (err) {
    next(err);
  }
});

const acceptSchema = z.object({ password: z.string().min(8) });

adminInvitesRouter.post("/:token/accept", validate(acceptSchema), async (req, res, next) => {
  try {
    const invite = await loadValidInvite(req.params.token);
    if (!invite) throw HttpError.notFound("This invite is no longer valid.");

    const { password } = req.body as z.infer<typeof acceptSchema>;

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: invite.email,
      password,
      email_confirm: true,
    });
    if (createErr) throw HttpError.badRequest(createErr.message);

    const { error: adminUserErr } = await supabaseAdmin
      .from("admin_users")
      .upsert({ id: created.user.id, role: "staff", display_name: invite.email, is_active: true }, { onConflict: "id" });
    if (adminUserErr) throw HttpError.internal(adminUserErr.message);

    if (invite.role_ids.length) {
      await supabaseAdmin
        .from("user_roles")
        .insert(invite.role_ids.map((roleId: string) => ({ user_id: created.user.id, role_id: roleId })));
    }

    await supabaseAdmin.from("admin_invites").update({ used_at: new Date().toISOString() }).eq("id", invite.id);

    await logAudit({
      userId: created.user.id,
      action: "USER_CREATED",
      resource: "users",
      resourceId: created.user.id,
      metadata: { via: "invite", roleIds: invite.role_ids },
      req,
    });

    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
