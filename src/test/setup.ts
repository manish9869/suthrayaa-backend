/**
 * Global test wiring for route tests: the Supabase client is replaced by the in-memory fake,
 * JWT verification by a deterministic stub, and Razorpay by a local order factory — so the
 * real Express app, middleware and services run end to end without any network.
 */
import { vi, beforeEach } from "vitest";

vi.mock("../config/supabase.js", async () => {
  const { db } = await import("./db.js");
  return { supabaseAdmin: db, supabaseAnon: db };
});

// Tokens look like `test~<userId>~<email>`; "expired" / anything else is rejected.
vi.mock("jose", () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: async (token: string) => {
    const [kind, sub, email] = token.split("~");
    if (kind !== "test" || !sub) throw new Error("invalid token");
    return { payload: { sub, email } };
  },
}));

let rzp = 0;
vi.mock("../config/razorpay.js", () => ({
  razorpay: {
    orders: {
      create: async (o: { amount: number; currency: string }) => ({ id: `order_test_${++rzp}`, amount: o.amount, currency: o.currency }),
    },
  },
  isRazorpayLive: false,
}));

beforeEach(async () => {
  const { invalidateSettingsCache } = await import("../modules/settings/settings.service.js");
  invalidateSettingsCache();
});
