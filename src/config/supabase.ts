import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { env } from "./env.js";

// supabase-js always constructs a Realtime client, which needs a native WebSocket —
// only available on Node 22+. Polyfilling it keeps this working on Node 20 even though
// this backend never actually uses realtime subscriptions.
if (!globalThis.WebSocket) {
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;
}

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
