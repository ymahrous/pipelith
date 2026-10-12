"use client";

import { useId, useRef, useState } from "react";
import { QUICK_ACCEPT } from "@/lib/util/routeFiles";
import { useQuickStart } from "./useQuickStart";

const ROUTES: [string, string][] = [
  [".zip, .vhd, .v, .sv", "Code review"],
  [".asm, .mem", "Assemble"],
  [".vcd + .asm", "Compare"],
  [".txt values", "Compare"],
];

/** One drop zone for every file type: each file lands on the page that uses it. */
export function QuickStart() {
  const { open } = useQuickStart();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();

  const take = async (list: FileList | null | undefined) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setBusy(true);
    setError(null);
    const err = await open(files);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div
      className={`quick${over ? " quick--over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void take(e.dataTransfer.files);
      }}
    >
      <input
        ref={input}
        type="file"
        multiple
        accept={QUICK_ACCEPT}
        className="visually-hidden"
        aria-label="Open files"
        onChange={(e) => {
          void take(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="quick__text">
        <strong>Have files already? Drop them here.</strong>
        <span id={hintId} className="small muted">
          Pipelith opens each one where it belongs. Files are read on this device and never uploaded.
        </span>
      </div>
      <ul className="quick__routes" aria-label="Where files go">
        {ROUTES.map(([ext, dest]) => (
          <li key={ext + dest}>
            <span className="mono">{ext}</span> → {dest}
          </li>
        ))}
      </ul>
      <button type="button" className="btn" aria-describedby={hintId} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Opening…" : "Choose files"}
      </button>
      {error && (
        <p className="quick__error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
