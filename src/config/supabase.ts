import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

/**
 * Service-role client — full DB/storage access, bypasses RLS.
 * Server-side only. Never expose SUPABASE_SECRET_KEY to any client.
 */
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
