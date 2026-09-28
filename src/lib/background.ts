import { waitUntil } from "@vercel/functions";

/**
 * Runs post-response work (emails, invoice generation) without blocking the HTTP response.
 * On Vercel the function instance is frozen as soon as the response is sent, which would
 * silently drop a bare fire-and-forget promise — waitUntil keeps the instance alive until
 * the task settles. Outside Vercel (local dev, a long-running Node host) it's a no-op and
 * the promise simply runs to completion. Callers attach their own .catch for logging.
 */
export function background(task: Promise<unknown>): void {
  waitUntil(task);
}
