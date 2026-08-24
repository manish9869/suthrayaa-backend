import multer from "multer";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";

export const BUCKETS = {
  productImages: "product-images",
  categoryImages: "category-images",
  heroMedia: "hero-media",
  avatars: "avatars",
  customerUploads: "customer-uploads",
} as const;

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      cb(new Error("Only JPEG, PNG, or WEBP images are allowed"));
      return;
    }
    cb(null, true);
  },
});

interface UploadResult {
  url: string;
  thumbnailUrl: string;
  path: string;
}

/**
 * Re-encodes an uploaded image (strips EXIF, normalizes to webp) and stores a main +
 * thumbnail pair in Supabase Storage. Validation happens here (server-side) rather than
 * via a client-held signed upload URL, since product image uploads are admin-only and
 * security-sensitive (arbitrary file -> public bucket).
 */
export async function uploadProductImage(bucket: string, folder: string, buffer: Buffer): Promise<UploadResult> {
  const id = randomUUID();

  const [main, thumb] = await Promise.all([
    sharp(buffer).rotate().resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
    sharp(buffer).rotate().resize({ width: 400, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer(),
  ]);

  const mainPath = `${folder}/${id}.webp`;
  const thumbPath = `${folder}/${id}-thumb.webp`;

  const { error: mainErr } = await supabaseAdmin.storage
    .from(bucket)
    .upload(mainPath, main, { contentType: "image/webp", upsert: false });
  if (mainErr) throw HttpError.internal(`Image upload failed: ${mainErr.message}`);

  const { error: thumbErr } = await supabaseAdmin.storage
    .from(bucket)
    .upload(thumbPath, thumb, { contentType: "image/webp", upsert: false });
  if (thumbErr) throw HttpError.internal(`Thumbnail upload failed: ${thumbErr.message}`);

  const { data: mainUrl } = supabaseAdmin.storage.from(bucket).getPublicUrl(mainPath);
  const { data: thumbUrl } = supabaseAdmin.storage.from(bucket).getPublicUrl(thumbPath);

  return { url: mainUrl.publicUrl, thumbnailUrl: thumbUrl.publicUrl, path: mainPath };
}

export async function deleteStorageObject(bucket: string, path: string) {
  await supabaseAdmin.storage.from(bucket).remove([path]);
}
