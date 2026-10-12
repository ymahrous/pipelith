/**
 * Display preferences: colour theme, text size, typeface and motion. They are
 * kept in this browser only (one localStorage key) and applied as data-*
 * attributes on <html>, which globals.css reads.
 *
 * DISPLAY_SCRIPT applies them before the first paint, so a visitor who needs
 * dark mode, larger text or the high-legibility typeface never sees a flash of
 * the defaults. It is a constant (no user input reaches it) and is emitted
 * with the CSP nonce by components/DisplayScript.tsx; display.test.ts keeps it
 * in step with parseDisplay().
 */

export const DISPLAY_KEY = "pipelith:display";

export interface DisplayPrefs {
  theme: "system" | "light" | "dark";
  text: "default" | "large" | "larger";
  /** playful: Recursive (casual on hover). readable: Atkinson Hyperlegible. */
  font: "playful" | "readable";
  motion: "system" | "reduce";
}

export const DEFAULT_DISPLAY: DisplayPrefs = { theme: "system", text: "default", font: "playful", motion: "system" };

const ALLOWED = {
  theme: ["system", "light", "dark"],
  text: ["default", "large", "larger"],
  font: ["playful", "readable"],
  motion: ["system", "reduce"],
} as const;

/** Validate untrusted stored data; anything unknown falls back to the default. */
export function parseDisplay(raw: unknown): DisplayPrefs {
  const o = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const pick = <K extends keyof DisplayPrefs>(k: K): DisplayPrefs[K] =>
    (ALLOWED[k] as readonly string[]).includes(o[k] as string) ? (o[k] as DisplayPrefs[K]) : DEFAULT_DISPLAY[k];
  return { theme: pick("theme"), text: pick("text"), font: pick("font"), motion: pick("motion") };
}

/** The data-* attributes for a set of preferences (undefined: remove the attribute). */
export function displayAttributes(p: DisplayPrefs): Record<string, string | undefined> {
  return {
    "data-theme": p.theme === "system" ? undefined : p.theme,
    "data-text": p.text === "default" ? undefined : p.text,
    "data-font": p.font === "readable" ? "readable" : undefined,
    "data-motion": p.motion === "reduce" ? "reduce" : undefined,
  };
}

export function applyDisplay(el: HTMLElement, p: DisplayPrefs) {
  for (const [k, v] of Object.entries(displayAttributes(p))) {
    if (v === undefined) el.removeAttribute(k);
    else el.setAttribute(k, v);
  }
}

export function loadDisplay(): DisplayPrefs {
  try {
    const raw = window.localStorage.getItem(DISPLAY_KEY);
    return raw && raw.length < 500 ? parseDisplay(JSON.parse(raw)) : { ...DEFAULT_DISPLAY };
  } catch {
    return { ...DEFAULT_DISPLAY };
  }
}

export function saveDisplay(p: DisplayPrefs) {
  try {
    const isDefault = (Object.keys(DEFAULT_DISPLAY) as (keyof DisplayPrefs)[]).every((k) => p[k] === DEFAULT_DISPLAY[k]);
    if (isDefault) window.localStorage.removeItem(DISPLAY_KEY);
    else window.localStorage.setItem(DISPLAY_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
}

/** Runs in <head> before the first paint. Same allow-lists as parseDisplay. */
export const DISPLAY_SCRIPT =
  '(function(){try{var r=localStorage.getItem("pipelith:display");if(!r||r.length>499)return;var d=JSON.parse(r),h=document.documentElement;' +
  'if(d.theme==="light"||d.theme==="dark")h.setAttribute("data-theme",d.theme);' +
  'if(d.text==="large"||d.text==="larger")h.setAttribute("data-text",d.text);' +
  'if(d.font==="readable")h.setAttribute("data-font","readable");' +
  'if(d.motion==="reduce")h.setAttribute("data-motion","reduce");}catch(e){}})();';
