import { describe, expect, it, vi } from "vitest";
import { THEME_PRESETS_BY_ID } from "../theme/theme.presets.js";

const active: { colors: Record<string, string> | null } = { colors: null };
vi.mock("../theme/theme.service.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../theme/theme.service.js")>();
  return { ...real, getActiveThemeColorsSync: () => active.colors };
});

const { applyStorefrontTheme, T } = await import("./theme.js");

const SAMPLE = `<td style="background:${T.ink};color:#FFFFFF"><a style="background:${T.violet}">Track</a><span style="color:${T.peachDeep.toLowerCase()}">•</span><b style="color:${T.green}">Paid</b></td>`;

describe("emails follow the storefront theme", () => {
  it("leaves emails untouched while the default theme is live", () => {
    active.colors = null;
    expect(applyStorefrontTheme(SAMPLE)).toBe(SAMPLE);
  });

  it("recolours brand colours (any case) but keeps white and status colours", () => {
    const rose = THEME_PRESETS_BY_ID.get("rose-blossom")!.colors;
    active.colors = rose;
    const out = applyStorefrontTheme(SAMPLE);
    expect(out).toContain(`background:${rose.ink}`);
    expect(out).toContain(`background:${rose.primary}`);
    expect(out).toContain(`color:${rose.rose}`);
    expect(out).toContain("color:#FFFFFF");
    expect(out).toContain(`color:${T.green}`);
    expect(out).not.toContain(T.violet);
  });
});
