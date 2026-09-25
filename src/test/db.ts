import { FakeSupabase } from "./fake-supabase.js";

/** The single fake database every route test talks to (see setup.ts). */
export const db = new FakeSupabase();
