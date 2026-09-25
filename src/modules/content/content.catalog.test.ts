import { describe, expect, it } from "vitest";
import { CONTENT_BLOCKS, CONTENT_ICONS, blockSchema, type ContentField } from "./content.catalog.js";

function iconValues(fields: ContentField[], value: Record<string, unknown>): string[] {
  return fields.flatMap((f) => {
    if (f.type === "icon") return [String(value[f.name] ?? "")];
    if (f.type === "list") return ((value[f.name] as Record<string, unknown>[]) ?? []).flatMap((item) => iconValues(f.fields ?? [], item));
    return [];
  });
}

describe("content catalog", () => {
  it("has unique block keys", () => {
    const keys = CONTENT_BLOCKS.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(CONTENT_BLOCKS.map((b) => [b.key, b] as const))("%s default passes its own schema unchanged", (_key, block) => {
    const parsed = blockSchema(block).safeParse(block.default);
    expect(parsed.success).toBe(true);
    // Nothing in the default is silently dropped (i.e. every default key is a declared field)
    expect(Object.keys(parsed.success ? parsed.data : {}).sort()).toEqual(expect.arrayContaining(Object.keys(block.default).sort()));
  });

  it("only uses icons the storefront can render", () => {
    for (const block of CONTENT_BLOCKS) {
      for (const name of iconValues(block.fields, block.default)) expect(CONTENT_ICONS).toContain(name);
    }
  });

  it("strips unknown keys and rejects wrong types", () => {
    const block = CONTENT_BLOCKS.find((b) => b.key === "home.trust_badges")!;
    const ok = blockSchema(block).parse({ items: [{ icon: "truck", title: "A", description: "B", extra: "x" }], junk: 1 });
    expect(ok).toEqual({ items: [{ icon: "truck", title: "A", description: "B" }] });
    expect(blockSchema(block).safeParse({ items: "nope" }).success).toBe(false);
  });
});
