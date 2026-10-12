"use client";

import { useId, useRef } from "react";
import { downloadBlob } from "@/lib/util/download";
import { useWorkbench } from "../SessionProvider";

/**
 * A ready-made prompt for the visitor's own AI assistant. Pipelith only puts it
 * on the clipboard or in a .txt file; it never sends it anywhere.
 */
export function AiPromptPanel({ prompt, open = false, title = "Ask an AI assistant to fix the structure" }: { prompt: string; open?: boolean; title?: string }) {
  const { toast } = useWorkbench();
  const area = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast("Prompt copied. Paste it into your AI assistant.");
    } catch {
      area.current?.focus();
      area.current?.select();
      toast("Copying isn't allowed here. The prompt is selected: press Ctrl+C or ⌘C.");
    }
  };
  return (
    <details className="panel ai-prompt" open={open}>
      <summary className="small">
        <strong>{title}</strong> — a ready-made prompt with your file names
      </summary>
      <div className="stack stack--tight section">
        <p className="small">
          Paste it into the AI assistant you use (ChatGPT, Claude, Gemini, Copilot or another). It lists your file names, the
          language and depth you selected, and what the structure check found — <strong>none of your code</strong>. Pipelith
          doesn&apos;t send it anywhere.
        </p>
        <div className="btn-row">
          <button type="button" className="btn btn--small btn--primary" onClick={copy}>
            Copy prompt
          </button>
          <button type="button" className="btn btn--small" onClick={() => downloadBlob("restructure-prompt.txt", prompt, "text/plain")}>
            Download prompt (.txt)
          </button>
        </div>
        <label className="field" htmlFor={id}>
          <span className="field__label">Prompt</span>
          <textarea id={id} ref={area} className="ai-prompt__text mono" readOnly value={prompt} rows={10} spellCheck={false} />
        </label>
        <p className="xsmall muted">
          AI assistants make mistakes: read the suggested moves before running them, and work on a copy of your folder.
        </p>
      </div>
    </details>
  );
}
