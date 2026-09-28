import type { Express } from "express";
import type { ZodSchema } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/* eslint-disable @typescript-eslint/no-explicit-any */

// OpenAPI 3 spec generated from the live Express router tree, so it can't drift from the code:
//   • paths + methods      ← the registered routes (mount prefix + route path)
//   • request body / query ← schemas attached by validate()          (middleware/validate.ts)
//   • admin permission     ← slugs attached by requirePermission()   (middleware/requirePermission.ts)
//   • auth requirement     ← authenticate / optionalAuthenticate / requireAdmin in the chain
// Human-written summaries for the main endpoints live in SUMMARIES below; everything else gets
// a generated one. Served at GET /api/openapi.json and rendered by Swagger UI at GET /api/docs.

interface Meta {
  validate?: { schema: ZodSchema; target: "body" | "query" | "params" };
  permissions?: string[];
  any?: boolean;
}

interface CollectedRoute {
  method: string;
  path: string;
  handlers: any[];
  inherited: any[];
}

/** Express 4 stores a mount path only as a RegExp; our mounts are all static strings. */
function mountPathFromLayer(layer: any): string {
  if (layer.path && typeof layer.path === "string") return layer.path;
  const src: string = layer.regexp?.source ?? "";
  if (src === "^\\/?$" || src === "^\\/?(?=\\/|$)") return "";
  return src
    .replace(/^\^/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(/\\\/\?\$$/, "")
    .replace(/\\\//g, "/")
    .replace(/\$$/, "");
}

function collect(stack: any[], prefix: string, inherited: any[], out: CollectedRoute[]) {
  const scoped = [...inherited];
  for (const layer of stack) {
    if (layer.route) {
      const handlers = layer.route.stack.map((l: any) => l.handle);
      for (const method of Object.keys(layer.route.methods)) {
        out.push({ method, path: prefix + (layer.route.path === "/" ? "" : layer.route.path), handlers, inherited: [...scoped] });
      }
    } else if (layer.name === "router" && layer.handle?.stack) {
      collect(layer.handle.stack, prefix + mountPathFromLayer(layer), scoped, out);
    } else {
      // Router-level middleware (router.use(authenticate, requireAdmin)) applies to later routes
      scoped.push(layer.handle);
    }
  }
}

const TAG_NAMES: Record<string, string> = {
  categories: "Catalog",
  products: "Catalog",
  colors: "Catalog",
  testimonials: "Storefront content",
  "hero-slides": "Storefront content",
  "site-settings": "Storefront content",
  "nav-items": "Storefront content",
  "footer-links": "Storefront content",
  "homepage-sections": "Storefront content",
  reviews: "Reviews",
  checkout: "Checkout & payments",
  coupons: "Checkout & payments",
  contact: "Contact",
  me: "Customer account",
  webhooks: "Webhooks",
  health: "System",
};

function tagFor(path: string): string {
  const parts = path.replace(/^\/api\//, "").split("/");
  if (parts[0] === "admin") {
    const area = parts[1] && !parts[1].startsWith("{") ? parts[1] : "me";
    const title = area.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return `Admin · ${title}`;
  }
  return TAG_NAMES[parts[0]] ?? parts[0];
}

/** Hand-written summaries for the endpoints a new developer reaches for first. */
const SUMMARIES: Record<string, string> = {
  "GET /api/health": "Liveness + database connectivity check",
  "GET /api/products": "List active products (filter by category, search, flags; paginated)",
  "GET /api/products/{slug}": "Product detail by slug",
  "GET /api/products/{slug}/reviews": "Published reviews for a product",
  "GET /api/categories": "Active category tree with product counts",
  "POST /api/reviews": "Submit a product review (held for moderation)",
  "POST /api/checkout/validate-cart": "Price a cart: items, coupon, shipping, GST — no side effects",
  "POST /api/checkout/check-cart": "Per-line availability check (never throws for a bad line)",
  "GET /api/checkout/options": "Payment methods and order rules shown at checkout",
  "POST /api/checkout/place-order": "Create an order (COD, or Razorpay order for online payment)",
  "POST /api/checkout/verify-payment": "Verify a Razorpay payment signature and mark the order paid",
  "POST /api/webhooks/razorpay": "Razorpay webhook (payment.captured / order.paid / payment.failed)",
  "GET /api/me": "Current customer's profile",
  "PATCH /api/me": "Update the current customer's profile",
  "GET /api/me/orders": "Current customer's orders",
  "POST /api/me/orders/{id}/cancel": "Cancel an order (allowed before it ships)",
  "POST /api/me/orders/{id}/pay": "Retry online payment for an unpaid order",
  "GET /api/me/orders/{id}/invoice": "Download the order's GST invoice PDF",
  "GET /api/me/cart": "Server-side cart (signed-in customers)",
  "PUT /api/me/cart": "Merge (default) or replace the server-side cart",
  "PUT /api/me/wishlist": "Replace the server-side wishlist",
  "GET /api/admin/me": "Signed-in admin's roles and effective permissions",
  "PATCH /api/admin/orders/{id}/status": "Move an order through fulfilment (emails the customer)",
  "POST /api/admin/customization-templates/{id}/clone": "Copy a template into a product as a new option group",
};

const ERROR_SCHEMA = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        message: { type: "string" },
        code: { type: "string" },
        details: { description: "Validation details (zod flatten()) for 400s" },
      },
      required: ["message"],
    },
  },
};

function toJsonSchema(schema: ZodSchema) {
  const json = zodToJsonSchema(schema, { target: "openApi3", $refStrategy: "none" }) as any;
  delete json.$schema;
  return json;
}

export function buildOpenApiSpec(app: Express, serverUrl?: string) {
  const routes: CollectedRoute[] = [];
  collect((app as any)._router?.stack ?? [], "", [], routes);

  const paths: Record<string, Record<string, any>> = {};
  const tags = new Set<string>();

  for (const r of routes) {
    if (!r.path.startsWith("/api/") || r.path === "/api/openapi.json" || r.path === "/api/docs") continue;
    const oaPath = r.path.replace(/:([A-Za-z_]+)/g, "{$1}");
    const chain = [...r.inherited, ...r.handlers];
    const names = new Set(chain.map((h) => h?.name));
    const metas = chain.map((h) => h?.openapi as Meta | undefined).filter(Boolean) as Meta[];

    const requiresAuth = names.has("authenticate");
    const optionalAuth = names.has("optionalAuthenticate");
    const isAdmin = names.has("requireAdmin");
    const permissionMeta = metas.find((m) => m.permissions);
    const bodyMeta = metas.find((m) => m.validate?.target === "body");
    const queryMeta = metas.find((m) => m.validate?.target === "query");

    const tag = tagFor(oaPath);
    tags.add(tag);
    const key = `${r.method.toUpperCase()} ${oaPath}`;

    const notes: string[] = [];
    if (isAdmin) notes.push("Requires an active **admin** account.");
    else if (requiresAuth) notes.push("Requires a signed-in customer (Supabase access token).");
    else if (optionalAuth) notes.push("Works for guests; a bearer token links the request to the customer.");
    if (permissionMeta?.permissions)
      notes.push(`Permission: ${permissionMeta.permissions.map((p) => `\`${p}\``).join(permissionMeta.any ? " or " : " and ")} (Super Admin bypasses).`);

    const parameters: any[] = [...oaPath.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    if (queryMeta?.validate) {
      const qs = toJsonSchema(queryMeta.validate.schema);
      for (const [name, schema] of Object.entries<any>(qs.properties ?? {})) {
        parameters.push({ name, in: "query", required: (qs.required ?? []).includes(name), schema });
      }
    }

    const responses: Record<string, any> = {
      [r.method === "post" ? "201" : "200"]: { description: "Success" },
    };
    if (bodyMeta || queryMeta) responses["400"] = { description: "Validation failed", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
    if (requiresAuth) responses["401"] = { description: "Missing or invalid access token", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
    if (isAdmin) responses["403"] = { description: "Not an admin, or lacks the permission", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
    if (oaPath.includes("{")) responses["404"] = { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };

    const op: any = {
      tags: [tag],
      summary: SUMMARIES[key] ?? `${r.method.toUpperCase()} ${oaPath.replace(/^\/api/, "")}`,
      operationId: `${r.method}_${oaPath.replace(/^\/api\//, "").replace(/[{}]/g, "").replace(/[^A-Za-z0-9]+/g, "_")}`,
      ...(notes.length ? { description: notes.join("\n\n") } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(bodyMeta?.validate
        ? { requestBody: { required: true, content: { "application/json": { schema: toJsonSchema(bodyMeta.validate.schema) } } } }
        : {}),
      responses,
      ...(requiresAuth ? { security: [{ bearerAuth: [] }] } : optionalAuth ? { security: [{}, { bearerAuth: [] }] } : {}),
    };
    if (oaPath.endsWith("/images") || oaPath.endsWith("/upload-image")) {
      op.requestBody = {
        required: true,
        content: { "multipart/form-data": { schema: { type: "object", properties: { image: { type: "string", format: "binary" } }, required: ["image"] } } },
      };
    }

    (paths[oaPath] ??= {})[r.method] = op;
  }

  const sortedTags = [...tags].sort((a, b) => Number(a.startsWith("Admin")) - Number(b.startsWith("Admin")) || a.localeCompare(b));

  return {
    openapi: "3.0.3",
    info: {
      title: "Suthrayaa API",
      version: "1.0.0",
      description:
        "REST API behind the Suthrayaa storefront and admin console.\n\n" +
        "**Auth:** send the Supabase session access token as `Authorization: Bearer <token>`. " +
        "Customer routes live under `/api/me`; admin routes under `/api/admin` also check the caller's RBAC permissions on every request.\n\n" +
        "**Errors** always have the shape `{ error: { message, code, details? } }`.\n\n" +
        "This document is generated from the running route table, so it always matches the deployed code.",
    },
    servers: [{ url: serverUrl ?? "/" }],
    tags: sortedTags.map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "Supabase JWT" } },
      schemas: { Error: ERROR_SCHEMA },
    },
  };
}

/** Swagger UI page (assets from jsDelivr) pointed at the generated spec. */
export const SWAGGER_UI_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Suthrayaa API docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>body{margin:0} .topbar{display:none}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "openapi.json",
      dom_id: "#swagger-ui",
      deepLinking: true,
      persistAuthorization: true,
      docExpansion: "none",
      tagsSorter: "alpha",
      filter: true,
    });
  </script>
</body>
</html>`;

/** Relaxed CSP for the docs page only (the API's default helmet CSP blocks CDN scripts). */
export const SWAGGER_UI_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https:; connect-src 'self'; font-src 'self' data: https://cdn.jsdelivr.net";
