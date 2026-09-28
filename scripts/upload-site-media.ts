/**
 * Uploads the storefront's static media (editorial scenes, reels, legacy product/category
 * photos) from the frontend's `public/` folder to the public `site-media` bucket, keeping the
 * same relative paths — so `/editorial/scene-bags.webp` lives at
 * `<SUPABASE_URL>/storage/v1/object/public/site-media/editorial/scene-bags.webp`.
 *
 * Favicons, PWA icons, the loader logo and placeholders stay in `public/` (tiny, first-paint).
 * Idempotent: re-running overwrites objects with the local copy.
 *
 *   npm run upload:site-media -- [path/to/frontend/public]
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "../src/config/supabase.js";
import { BUCKETS } from "../src/modules/storage/upload.js";

const BUCKET = BUCKETS.siteMedia;
const PUBLIC_DIR = path.resolve(process.argv[2] ?? "../suthrayaa/public");

const MEDIA_DIRS = ["editorial", "reels", "categories", "products", "testimonials"];
const ROOT_FILES = ["logo.png", "hero-crochet.jpg", "artisan-hands.jpg"];

const MIME: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

async function ensureBucket() {
  const options = { public: true, fileSizeLimit: "50MB", allowedMimeTypes: [...new Set(Object.values(MIME))] };
  const { data: existing } = await supabaseAdmin.storage.getBucket(BUCKET);
  const { error } = existing
    ? await supabaseAdmin.storage.updateBucket(BUCKET, options)
    : await supabaseAdmin.storage.createBucket(BUCKET, options);
  if (error) throw new Error(`Bucket "${BUCKET}" setup failed: ${error.message}`);
  console.log(`${existing ? "Updated" : "Created"} public bucket "${BUCKET}".`);
}

async function collectFiles(): Promise<string[]> {
  const files = [...ROOT_FILES];
  for (const dir of MEDIA_DIRS) {
    const entries = await readdir(path.join(PUBLIC_DIR, dir), { withFileTypes: true }).catch(() => []);
    for (const e of entries) if (e.isFile()) files.push(`${dir}/${e.name}`);
  }
  return files.filter((f) => MIME[path.extname(f).toLowerCase()]);
}

async function main() {
  await ensureBucket();
  const files = await collectFiles();
  let failed = 0;
  let skipped = 0;

  for (const rel of files) {
    const body = await readFile(path.join(PUBLIC_DIR, rel)).catch(() => null);
    if (!body) {
      skipped++;
      console.warn(`skip  ${rel} (not found locally)`);
      continue;
    }
    const { error } = await supabaseAdmin.storage.from(BUCKET).upload(rel, body, {
      contentType: MIME[path.extname(rel).toLowerCase()],
      cacheControl: "31536000",
      upsert: true,
    });
    if (error) {
      failed++;
      console.error(`FAIL  ${rel}: ${error.message}`);
    } else {
      console.log(`ok    ${rel}`);
    }
  }

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl("");
  console.log(`\n${files.length - failed}/${files.length} uploaded. Base URL: ${data.publicUrl.replace(/\/$/, "")}`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
