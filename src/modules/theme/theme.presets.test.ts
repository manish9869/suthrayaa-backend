import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID, THEME_PRESETS, THEME_PRESETS_BY_ID, THEME_TOKENS } from "./theme.presets.js";
import { themeColorsSchema } from "./theme.service.js";

describe("theme presets", () => {
  it("has 14 presets with unique ids", () => {
    expect(THEME_PRESETS.length).toBe(14);
    expect(THEME_PRESETS_BY_ID.size).toBe(THEME_PRESETS.length);
  });

  it.each(THEME_PRESETS.map((p) => [p.id, p] as const))("%s defines every token as a valid hex colour", (_id, preset) => {
    expect(Object.keys(preset.colors).sort()).toEqual(THEME_TOKENS.map((t) => t.key).sort());
    expect(themeColorsSchema.safeParse(preset.colors).success).toBe(true);
  });

  // The default must equal the storefront's own design (suthrayaa app/globals.css :root on main),
  // because the storefront emits no overrides while it's active.
  it("default preset matches the storefront's base :root tokens", () => {
    const d = THEME_PRESETS_BY_ID.get(DEFAULT_THEME_ID)!.colors;
    expect(d).toMatchObject({
      primary: "#6d4aff",
      primaryForeground: "#ffffff",
      secondary: "#ff9e7a",
      secondaryForeground: "#3a1e14",
      accent: "#efeaff",
      accentForeground: "#4b2fd6",
      background: "#fcfbff",
      card: "#ffffff",
      muted: "#f4f1fb",
      mutedForeground: "#6b6680",
      border: "#e8e3f5",
      foreground: "#1f1a33",
      ink: "#1c1642",
      rose: "#e2603f",
      gold: "#f5b544",
      sage: "#b9a8ff",
      blush: "#ffe6dc",
      sand: "#f3efff",
    });
  });
});

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("theme preset readability (WCAG AA)", () => {
  it.each(THEME_PRESETS.map((p) => [p.id, p.colors] as const))("%s has readable text and buttons", (_id, c) => {
    expect(contrast(c.foreground, c.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.primaryForeground, c.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.mutedForeground, c.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.accentForeground, c.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.secondaryForeground, c.secondary)).toBeGreaterThanOrEqual(3);
  });
});
