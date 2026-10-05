"use client";

import { useId, useRef, useState } from "react";

/** Drop zone + file picker. Files are read locally; nothing is uploaded. */
export function FileDrop({
  accept,
  label,
  hint,
  onFile,
}: {
  accept: string;
  label: string;
  hint: string;
  onFile: (f: File) => void;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <div
      className={`drop${over ? " drop--over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        className="visually-hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <button type="button" className="btn" onClick={() => input.current?.click()}>
        {label}
      </button>
      <span>{hint}</span>
    </div>
  );
}
