/**
 * Writes the generated OpenAPI spec to docs/openapi.json (for Postman / code generators /
 * reading offline). The live copy is always at GET /api/openapi.json and /api/docs.
 * Usage: npm run docs:openapi
 */
import { writeFileSync, mkdirSync } from "node:fs";
import app from "../src/app.js";
import { buildOpenApiSpec } from "../src/docs/openapi.js";

const spec = buildOpenApiSpec(app, "https://suthrayaa-backend.vercel.app");
mkdirSync("docs", { recursive: true });
writeFileSync("docs/openapi.json", JSON.stringify(spec, null, 2) + "\n");
const ops = Object.values(spec.paths).reduce((n, p) => n + Object.keys(p).length, 0);
console.log(`Wrote docs/openapi.json — ${Object.keys(spec.paths).length} paths, ${ops} operations`);
process.exit(0);
