"use client";

import Link from "next/link";
import { useWorkbench } from "./SessionProvider";
import { STEPS, type StepSlug } from "./steps";

/** Common page frame for a workbench step: heading, body and back/next navigation. */
export function StepFrame({
  slug,
  intro,
  children,
  nextDisabled,
  nextHint,
  nextSlug,
  extraNext,
}: {
  slug: StepSlug;
  intro: React.ReactNode;
  children: React.ReactNode;
  nextDisabled?: boolean;
  nextHint?: string;
  /** Skip ahead (e.g. Check → Report when only the program is being checked). */
  nextSlug?: StepSlug;
  extraNext?: React.ReactNode;
}) {
  const { ready, pendingShare, acceptShare, dismissShare } = useWorkbench();
  const i = STEPS.findIndex((s) => s.slug === slug);
  const step = STEPS[i];
  const prev = STEPS[i - 1];
  const next = nextSlug ? STEPS.find((s) => s.slug === nextSlug)! : STEPS[i + 1];
  return (
    <div className="step">
      {pendingShare && (
        <div className="notice notice--probe no-print" role="region" aria-label="Shared program">
          <span aria-hidden="true">↗</span>
          <div className="stack stack--tight">
            <div>
              <strong>Open the shared program “{pendingShare.name}”?</strong>
              It replaces the program you have open in this browser.
            </div>
            <div className="btn-row">
              <button className="btn btn--primary btn--small" onClick={acceptShare}>
                Open shared program
              </button>
              <button className="btn btn--small" onClick={dismissShare}>
                Keep mine
              </button>
            </div>
          </div>
        </div>
      )}
      <header className="step-head">
        <h1>{step.title}</h1>
        <p>{intro}</p>
      </header>
      {ready ? children : <p className="muted">Loading your session…</p>}
      <nav className="step-foot no-print" aria-label="Step navigation">
        {prev ? (
          <Link className="btn" href={`/workbench/${prev.slug}`}>
            Back to {prev.label}
          </Link>
        ) : (
          <span />
        )}
        {extraNext}
        {next &&
          (nextDisabled ? (
            <span className="btn btn--primary" aria-disabled="true" title={nextHint}>
              Continue to {next.label}
            </span>
          ) : (
            <Link className="btn btn--primary" href={`/workbench/${next.slug}`}>
              Continue to {next.label}
            </Link>
          ))}
      </nav>
    </div>
  );
}
