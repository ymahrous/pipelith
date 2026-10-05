"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { EXAMPLES } from "@/lib/examples/programs";
import { useWorkbench } from "./SessionProvider";
import { useQuickStart } from "./useQuickStart";

/** /try: the full demo in one click — asks first if it would replace the visitor's own program. */
export function TryDemo() {
  const { ready, session } = useWorkbench();
  const { runDemo } = useQuickStart();
  const started = useRef(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!ready || started.current) return;
    const ownWork = session.source.trim() && !EXAMPLES.some((e) => e.source === session.source);
    started.current = true;
    if (ownWork) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- decided once, after the stored session loads
      setConfirm(true);
    } else runDemo();
  }, [ready, session.source, runDemo]);

  if (confirm) {
    return (
      <div className="empty stack stack--tight">
        <h2>Replace “{session.name}” with the demo?</h2>
        <p className="muted">
          The demo opens the bundled Memory test and the reference design&apos;s waveform. Your program is replaced; download or
          share it first if you want to keep it.
        </p>
        <div className="btn-row">
          <button className="btn btn--primary" onClick={runDemo}>
            Run the demo
          </button>
          <Link className="btn" href="/workbench/program">
            Keep my program
          </Link>
        </div>
      </div>
    );
  }
  return (
    <p className="muted" role="status">
      Opening the demo: loading the Memory test and its GHDL waveform…
    </p>
  );
}
