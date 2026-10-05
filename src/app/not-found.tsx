import Link from "next/link";

export default function NotFound() {
  return (
    <div className="step">
      <div className="empty stack stack--tight">
        <h1>This page doesn&apos;t exist</h1>
        <p className="muted">The address may be mistyped, or the page has moved. These are the usual places to go:</p>
        <div className="btn-row">
          <Link className="btn btn--primary" href="/try">
            Run the demo
          </Link>
          <Link className="btn" href="/review">
            Review my code
          </Link>
          <Link className="btn" href="/workbench/program">
            Open the workbench
          </Link>
          <Link className="btn btn--ghost" href="/docs">
            Documentation
          </Link>
        </div>
      </div>
    </div>
  );
}
