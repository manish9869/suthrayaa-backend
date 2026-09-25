import pino from "pino";
import { env } from "../config/env.js";

// pino-pretty is a devDependency and runs in a worker thread, so it's only usable in local dev —
// never on Vercel/serverless, where it isn't bundled (even if NODE_ENV isn't set to production).
const usePretty = env.NODE_ENV === "development" && !process.env.VERCEL;

export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : env.NODE_ENV === "test" ? "silent" : "debug",
  transport: usePretty
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
    : undefined,
});
