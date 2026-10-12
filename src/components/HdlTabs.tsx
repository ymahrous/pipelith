"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { HDL_INFO, HDLS, type Hdl } from "@/lib/hdl";
import { withHdl } from "@/lib/session/session";
import { useWorkbench } from "./SessionProvider";

/**
 * Language-specific content as tabs. Every panel is in the page (search and
 * answer engines read them all); the one for the selected design language is
 * shown, and choosing a tab changes that setting for the whole site.
 */
export function HdlTabs({ label, panels }: { label: string; panels: Partial<Record<Hdl, ReactNode>> }) {
  const { session, update } = useWorkbench();
  const base = useId();
  const langs = HDLS.filter((h) => panels[h] !== undefined);
  const active = langs.includes(session.hdl) ? session.hdl : langs[0];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const choose = (h: Hdl) => update((s) => withHdl(s, h));
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = langs.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    choose(langs[to]);
    refs.current[to]?.focus();
  };
  return (
    <div className="hdl-tabs">
      <div className="tabs" role="tablist" aria-label={label}>
        {langs.map((h, i) => (
          <button
            key={h}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${h}`}
            aria-controls={`${base}-panel-${h}`}
            aria-selected={active === h}
            tabIndex={active === h ? 0 : -1}
            onClick={() => choose(h)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {HDL_INFO[h].label}
          </button>
        ))}
      </div>
      {langs.map((h) => (
        <div key={h} role="tabpanel" id={`${base}-panel-${h}`} aria-labelledby={`${base}-tab-${h}`} hidden={active !== h} className="stack stack--tight hdl-tabs__panel">
          {panels[h]}
        </div>
      ))}
    </div>
  );
}
