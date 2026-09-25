import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    // Route tests share one in-memory database, so files run one at a time
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      SUPABASE_URL: "http://localhost:54321",
      SUPABASE_PUBLISHABLE_KEY: "test",
      SUPABASE_SECRET_KEY: "test",
      SUPABASE_JWKS_URL: "http://localhost:54321/jwks",
      RAZORPAY_KEY_ID: "rzp_test_key",
      RAZORPAY_KEY_SECRET: "rzp_test_secret",
      RAZORPAY_WEBHOOK_SECRET: "whsec_test",
      FRONTEND_URL: "http://localhost:3000",
      ADMIN_NOTIFICATION_EMAIL: "",
      GMAIL_USER: "",
      GMAIL_APP_PASSWORD: "",
    },
  },
});
