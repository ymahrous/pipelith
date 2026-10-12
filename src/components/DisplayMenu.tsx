"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { applyDisplay, DEFAULT_DISPLAY, DISPLAY_KEY, parseDisplay, saveDisplay, type DisplayPrefs } from "@/lib/util/display";

const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener("pipelith-display", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("pipelith-display", cb);
  };
};
const read = () => {
  try {
    return window.localStorage.getItem(DISPLAY_KEY);
  } catch {
    return null;
  }
};

const GROUPS: { key: keyof DisplayPrefs; legend: string; options: [string, string][] }[] = [
  { key: "theme", legend: "Colours", options: [["system", "Match my device"], ["light", "Light"], ["dark", "Dark"]] },
  { key: "text", legend: "Text size", options: [["default", "Default"], ["large", "Large"], ["larger", "Larger"]] },
  { key: "font", legend: "Typeface", options: [["playful", "Recursive (playful)"], ["readable", "Atkinson Hyperlegible (easier to read)"]] },
  { key: "motion", legend: "Motion", options: [["system", "Match my device"], ["reduce", "Reduce"]] },
];

/** Colours, text size, typeface and motion — saved in this browser only. */
export function DisplayMenu() {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  let prefs: DisplayPrefs = DEFAULT_DISPLAY;
  try {
    prefs = raw ? parseDisplay(JSON.parse(raw)) : DEFAULT_DISPLAY;
  } catch {
    /* damaged value: defaults */
  }
  const box = useRef<HTMLDetailsElement>(null);

  // Close on Escape (focus back on the button) or a click elsewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && box.current?.open) {
        box.current.open = false;
        box.current.querySelector("summary")?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (box.current?.open && !box.current.contains(e.target as Node)) box.current.open = false;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, []);

  const set = (patch: Partial<DisplayPrefs>) => {
    const next = { ...prefs, ...patch };
    saveDisplay(next);
    applyDisplay(document.documentElement, next);
    window.dispatchEvent(new Event("pipelith-display"));
  };

  return (
    <details className="display-menu" ref={box}>
      <summary>
        <span className="display-menu__icon" aria-hidden="true">
          Aa
        </span>
        <span className="display-menu__label">Display</span>
      </summary>
      <div className="display-menu__panel">
        {GROUPS.map((g) => (
          <fieldset key={g.key} className="display-menu__group">
            <legend>{g.legend}</legend>
            {g.options.map(([value, label]) => (
              <label key={value} className="check-row">
                <input type="radio" name={`display-${g.key}`} value={value} checked={prefs[g.key] === value} onChange={() => set({ [g.key]: value } as Partial<DisplayPrefs>)} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
        ))}
        <p className="xsmall muted">Saved in this browser only. Your browser&apos;s zoom and system settings work too.</p>
      </div>
    </details>
  );
}
