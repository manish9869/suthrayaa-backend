/**
 * Loads every .html file in src/modules/email/templates/ into the email_templates table.
 * The filename (minus .html) is the template `type`; a `<!-- SUBJECT: ... -->` comment on the
 * first line is the subject line, everything after it is the body HTML.
 *
 * These files are the source of truth for subject/body — re-run this after editing one to
 * push the change live. The `enabled` flag is left alone on existing rows (that stays admin-
 * controlled from the Email Templates page); new templates are inserted enabled by default.
 *
 * Safe to re-run any time.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { supabaseAdmin } from "../src/config/supabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.join(__dirname, "..", "src", "modules", "email", "templates");

function parseTemplateFile(raw: string): { subject: string; bodyHtml: string } {
  const match = raw.match(/^<!--\s*SUBJECT:\s*(.*?)\s*-->\s*\n([\s\S]*)$/);
  if (!match) throw new Error("Template file must start with a <!-- SUBJECT: ... --> comment");
  return { subject: match[1], bodyHtml: match[2].trim() };
}

async function main() {
  const files = readdirSync(templatesDir).filter((f) => f.endsWith(".html"));
  if (files.length === 0) {
    console.log("No .html template files found in", templatesDir);
    return;
  }

  for (const file of files) {
    const type = file.replace(/\.html$/, "");
    const raw = readFileSync(path.join(templatesDir, file), "utf8");
    const { subject, bodyHtml } = parseTemplateFile(raw);

    const { data: existing } = await supabaseAdmin.from("email_templates").select("id").eq("type", type).maybeSingle();

    if (existing) {
      const { error } = await supabaseAdmin
        .from("email_templates")
        .update({ subject, body_html: bodyHtml, updated_at: new Date().toISOString() })
        .eq("type", type);
      if (error) throw error;
      console.log(`updated  ${type}`);
    } else {
      const { error } = await supabaseAdmin.from("email_templates").insert({ type, subject, body_html: bodyHtml, enabled: true });
      if (error) throw error;
      console.log(`inserted ${type}`);
    }
  }

  console.log(`\nSynced ${files.length} template(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
