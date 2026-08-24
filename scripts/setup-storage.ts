import { supabaseAdmin } from "../src/config/supabase.js";
import { BUCKETS } from "../src/modules/storage/upload.js";

const PUBLIC_BUCKETS = [BUCKETS.productImages, BUCKETS.categoryImages, BUCKETS.heroMedia, BUCKETS.avatars];
const PRIVATE_BUCKETS = [BUCKETS.customerUploads];

async function ensureBucket(name: string, isPublic: boolean) {
  const { data: existing } = await supabaseAdmin.storage.getBucket(name);
  if (existing) {
    console.log(`Bucket "${name}" already exists — skipping.`);
    return;
  }
  const { error } = await supabaseAdmin.storage.createBucket(name, {
    public: isPublic,
    fileSizeLimit: "5MB",
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });
  if (error) {
    console.error(`Failed to create bucket "${name}":`, error.message);
  } else {
    console.log(`Created ${isPublic ? "public" : "private"} bucket "${name}".`);
  }
}

async function main() {
  for (const b of PUBLIC_BUCKETS) await ensureBucket(b, true);
  for (const b of PRIVATE_BUCKETS) await ensureBucket(b, false);
  console.log("Storage setup complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
