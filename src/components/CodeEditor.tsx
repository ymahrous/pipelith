"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import type { Diagnostic } from "@/lib/asm/assembler";

export interface CodeEditorHandle {
  goToLine: (line: number) => void;
}

/**
 * Plain textarea with a line-number gutter that marks lines with
 * diagnostics. Deliberately simple: no contenteditable, no HTML rendering
 * of user text, nothing that could be turned into markup injection.
 */
export const CodeEditor = forwardRef<
  CodeEditorHandle,
  {
    value: string;
    onChange: (v: string) => void;
    diagnostics?: Diagnostic[];
    label: string;
    readOnly?: boolean;
  }
>(function CodeEditor({ value, onChange, diagnostics = [], label, readOnly }, ref) {
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const lineCount = useMemo(() => Math.max(1, value.split("\n").length), [value]);
  const marks = useMemo(() => {
    const m = new Map<number, "error" | "warning">();
    for (const d of diagnostics) {
      if (d.severity === "error") m.set(d.line, "error");
      else if (d.severity === "warning" && !m.has(d.line)) m.set(d.line, "warning");
    }
    return m;
  }, [diagnostics]);

  useImperativeHandle(ref, () => ({
    goToLine(line: number) {
      const ta = area.current;
      if (!ta) return;
      const lines = ta.value.split("\n");
      let start = 0;
      for (let i = 0; i < line - 1 && i < lines.length; i++) start += lines[i].length + 1;
      const end = start + (lines[line - 1]?.length ?? 0);
      ta.focus();
      ta.setSelectionRange(start, end);
      ta.scrollTop = Math.max(0, (line - 4) * 20);
    },
  }));

  return (
    <div className="editor">
      <div className="editor__gutter" ref={gutter} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, i) => {
          const mark = marks.get(i + 1);
          return (
            <div key={i} className={mark ? `ln--${mark}` : undefined}>
              {i + 1}
            </div>
          );
        })}
      </div>
      <textarea
        ref={area}
        value={value}
        readOnly={readOnly}
        aria-label={label}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        wrap="off"
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
        }}
      />
    </div>
  );
});
