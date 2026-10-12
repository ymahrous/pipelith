import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { DEFAULT_DISPLAY, DISPLAY_KEY, DISPLAY_SCRIPT, displayAttributes, parseDisplay } from "./display";

/** Run the pre-paint script against fake storage and a fake <html>, the way a browser would. */
function runScript(stored: string | null) {
  const attrs = new Map<string, string>();
  const html = { setAttribute: (k: string, v: string) => attrs.set(k, v) };
  const localStorage = { getItem: (k: string) => (k === DISPLAY_KEY ? stored : null) };
  runInNewContext(DISPLAY_SCRIPT, { localStorage, document: { documentElement: html }, JSON });
  return Object.fromEntries(attrs);
}

describe("display preferences", () => {
  it("validates stored values and falls back to defaults", () => {
    expect(parseDisplay(null)).toEqual(DEFAULT_DISPLAY);
    expect(parseDisplay({ theme: "dark", text: "huge", font: "readable", motion: "reduce", extra: 1 })).toEqual({ theme: "dark", text: "default", font: "readable", motion: "reduce" });
    expect(parseDisplay(JSON.parse('{"__proto__":{"theme":"dark"}}'))).toEqual(DEFAULT_DISPLAY);
  });
  it("maps preferences to data attributes, leaving defaults off", () => {
    expect(displayAttributes(DEFAULT_DISPLAY)).toEqual({ "data-theme": undefined, "data-text": undefined, "data-font": undefined, "data-motion": undefined });
    expect(displayAttributes({ theme: "light", text: "larger", font: "readable", motion: "reduce" })).toEqual({ "data-theme": "light", "data-text": "larger", "data-font": "readable", "data-motion": "reduce" });
  });
  it("the pre-paint script applies exactly what parseDisplay accepts", () => {
    const cases = [
      { theme: "dark", text: "large", font: "readable", motion: "reduce" },
      { theme: "light", text: "larger", font: "playful", motion: "system" },
      { theme: "<script>", text: "9", font: "x", motion: "y" },
    ];
    for (const c of cases) {
      const expected = Object.fromEntries(Object.entries(displayAttributes(parseDisplay(c))).filter(([, v]) => v !== undefined));
      expect(runScript(JSON.stringify(c))).toEqual(expected);
    }
    expect(runScript(null)).toEqual({});
    expect(runScript("not json")).toEqual({});
    expect(runScript("x".repeat(600))).toEqual({});
  });
});
