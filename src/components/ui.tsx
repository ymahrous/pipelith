import type { Diagnostic } from "@/lib/asm/assembler";

export const h8 = (v: number) => (v >>> 0).toString(16).toUpperCase().padStart(8, "0");
export const hx = (v: number) => "0x" + (v >>> 0).toString(16).toUpperCase();

export function Badge({ tone, children }: { tone?: "pass" | "fail" | "warn" | "probe"; children: React.ReactNode }) {
  return <span className={`badge${tone ? ` badge--${tone}` : ""}`}>{children}</span>;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function DiagnosticList({
  items,
  lineText,
  onLine,
}: {
  items: Diagnostic[];
  lineText?: (line: number) => string | undefined;
  onLine?: (line: number) => void;
}) {
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...items].sort((a, b) => order[a.severity] - order[b.severity] || a.line - b.line);
  return (
    <ul className="diag-list">
      {sorted.map((d, i) => (
        <li key={i} className={`diag diag--${d.severity}`}>
          {onLine ? (
            <button className="linkish" onClick={() => onLine(d.line)} aria-label={`Edit line ${d.line}`}>
              Line {d.line}
            </button>
          ) : (
            <span className="mono xsmall">Line {d.line}</span>
          )}
          <div>
            <div>
              <Badge tone={d.severity === "error" ? "fail" : d.severity === "warning" ? "warn" : undefined}>
                {d.severity === "error" ? "Error" : d.severity === "warning" ? "Warning" : "Note"}
              </Badge>{" "}
              {d.message}
            </div>
            {lineText?.(d.line) && <code className="muted xsmall">{lineText(d.line)}</code>}
          </div>
        </li>
      ))}
    </ul>
  );
}
