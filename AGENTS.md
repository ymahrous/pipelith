# AGENTS.md

Instructions for AI coding agents working in this repository. Humans: see CONTRIBUTING.md.

## What this is

**Pipelith** — a Next.js 16 app (App Router, React 19, TypeScript strict) for validating pipelined RISC processors (5 or 6 stages, with configurable forwarding): assembler → reference ISA model → pipeline timing estimate → comment-derived checks → VCD / final-value comparison → report, plus a static **code review** of an uploaded VHDL codebase. **Everything runs in the browser; there is no backend logic.** Keep it that way.

## Commands

```bash
npm run dev              # dev server :3000
npm test                 # vitest unit tests (fast, run often)
npm run typecheck        # tsc --noEmit
npm run lint             # eslint (flat config, eslint.config.mjs)
npm run build            # production build
npm run test:e2e         # playwright, builds and serves on :3210
npm run check            # typecheck + lint + test + build — run before finishing
RTL_DIR=/path/to/src/rtl npm test   # adds the GHDL round trip (needs ghdl)
```

## Next.js 16 specifics

This is not the Next.js in most training data. Read `node_modules/next/dist/docs/` before using an API you are unsure of.

- Request interception lives in **`src/proxy.ts`** exporting `proxy()` (the old `middleware.ts` convention is deprecated).
- `next lint` no longer exists; use `npm run lint`.
- The root layout awaits `headers()` so every page renders per request — required for the CSP nonce. Do not make pages static.

## Hard rules

1. **No inline styles.** The CSP has no `'unsafe-inline'` for styles, so React `style={…}` props break in production. Add classes to `src/app/globals.css`. SVG presentation attributes (`fill`, `stroke`, `x`) are fine; `var(--x)` inside SVG attributes is not — use a CSS class.
2. **No raw HTML or eval.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`. ESLint enforces it.
3. **No third-party origins.** No CDNs, remote fonts or extra trackers; `connect-src` is `'self'`. The only measurement is Vercel Web Analytics + Speed Insights in `src/components/VercelMetrics.tsx`, served same-origin. It is rendered **only** when `metricsEnabled()` (`src/lib/site.ts`: `VERCEL=1` and not `NEXT_PUBLIC_DISABLE_ANALYTICS=1`), and every `beforeSend` must keep `analyticsBlocked()` and `scrubUrl()` (`src/lib/util/privacy.ts`). Never send user content, query strings or the URL fragment. If you change what is measured, update `/privacy` and `SECURITY_AUDIT.md`.
4. **Assembler output is frozen.** `assemble()` must produce exactly what `assembler.py` produces; fixtures in `src/lib/__fixtures__/` enforce it.
5. **Validate untrusted input.** Files, zips, VCDs, share links and localStorage go through bounded parsers and `parseSession`. Lookups keyed by user strings use `Map` or own-property checks, never plain object indexing. Zip entries are inflated with a streaming size cap (`review/intake.ts`).
6. **Generated VHDL/shell only receives allow-listed values** (`safeIdent`, `safeFileName`, `safeRelPath`) or clamped numbers.
7. **Clamp numbers with `Math.floor` + range checks**, never `| 0` (it truncates to 32 bits).
8. **Code review errors must be real.** The reference-processor test in `review.test.ts` requires 0 errors on working RTL; a new rule that adds one is a false positive. Use warning/info for anything heuristic.
9. **Never hard-code stage names.** Read `geometry(depth)` from `src/lib/pipeline/pipeline.ts`.
10. **Forwarding comes from the session.** Timing, verdicts, testbench notes, reports and review rules take `session.forwarding` (`ForwardingConfig`) and use `activePaths()` / `hazardStall()` / `describeForwarding()`. Don't assume full forwarding; default parameters exist only for old call sites and tests.
11. **One settings control.** Depth and forwarding are edited only through `PipelineSettings` (`src/components/DepthPicker.tsx`), which every scan renders. Don't add a second picker.
12. **The name has one source.** The product is **Pipelith** (tagline: *Pipeline verification for RISC processors*). UI, metadata and JSON-LD read `SITE.name` / `SITE.tagline`, generators in `src/lib` read `BRAND` (`src/lib/site.ts`). Don't hard-code the name. The logo mark is drawn in both `src/app/icon.svg` and `src/components/Brand.tsx`; change them together and regenerate `apple-icon.png` and the Open Graph/Twitter images. localStorage keys use the `pipelith:` prefix; `src/lib/util/storage.ts` migrates the old `processor-workbench:` keys once.
13. **Program changes go through `withProgram()`** (`src/lib/session/session.ts`). It keeps the design settings (`stages`, `forwarding`, `compileOrder`, `rtlRoot`, model options) and resets everything about the program. Never rebuild a session by hand with `emptySession()` + a list of fields — that is how settings got lost before.
14. **Review rules are documented.** Every `rule:` id emitted by `review.ts` must have an entry in `src/lib/review/rules.ts` with the same category; `rules.test.ts` fails otherwise. `/docs/review-rules` and the findings' "About this rule" links read it.
15. **Docs live in content files.** The docs sidebar, hub, sitemap and llms.txt read `src/lib/content/docs.ts`; glossary and troubleshooting text live in `glossary.ts` / `troubleshooting.ts`. Troubleshooting titles quote real UI messages and labels — grep for them before writing. The `/docs/checks` example is `content/checksExample.ts` and must keep passing every check.
16. **Fewer steps, no surprises.** Shortcuts (`useQuickStart`: dropped files, `/try` demo) may navigate and load data, but must never silently replace a program the visitor wrote — ask first, as `/try` does. Files cross pages only through the provider's in-memory `setHandoff`/`takeHandoff`.
17. **Content has one source.** FAQ text lives in `src/lib/content/faq.ts` (feeds `/faq` and its `FAQPage` JSON-LD); site name, URL, operator and legal dates in `src/lib/site.ts`. JSON-LD goes through `src/components/JsonLd.tsx` (nonce + `<` escaping) — never a raw `<script>`.

## Where things are

- `src/lib/isa/` — `ProcessorProfile` type and the `risc6` profile (the single source of truth for encoding, docs page and hardware binding).
- `src/lib/asm/` — assembler (`assembler.ts`), `.mem` import + disassembler (`memfile.ts`).
- `src/lib/sim/simulator.ts` — reference model; `stateAt()` replays state for the step scrubber.
- `src/lib/check/expectations.ts` — comment → `Check` parser, evaluator, IN-value inference.
- `src/lib/vcd/parser.ts` — streaming VCD parser.
- `src/lib/compare/compare.ts` — `autoMap()` signal discovery and `compareTrace()` sequence comparison.
- `src/lib/compare/finalValues.ts` — parser/comparison for typed final register values (the no-waveform option).
- `src/lib/compare/compare.ts › judgeTiming()` — hardware cycle count vs the depth's estimate.
- `src/lib/pipeline/pipeline.ts` — `geometry(5|6)` (stages, registers, forwarding sources, branch-resolve stage, multi-cycle costs), `ForwardingConfig` / `FULL_FORWARDING` / `NO_FORWARDING`, `hazardStall()`, and `estimateTiming(sim, profile, depth, forwarding)` (stall breakdown incl. data-hazard stalls, per-instruction fetch/write-back cycles).
- `src/lib/review/` — `intake.ts` (zip/folder/files → sources, limits), `lexer.ts`, `parse.ts` (block structure, entities, ports, processes as statement trees, instances), `review.ts` (rules → `Finding[]`, hierarchy, compile order, pipeline summary), `report.ts` (Markdown).
- `src/components/review/ReviewPage.tsx` — the `/review` page (incl. the post-upload structure check); `ZipGuide.tsx` — the explicit .zip structure guide, also rendered in `/guide#zip`.
- `src/components/DepthPicker.tsx` (`PipelineSettings`), `PipelineTiming.tsx` — depth + forwarding controls and pipeline diagram.
- `src/components/QuickStart.tsx`, `useQuickStart.ts`, `TryDemo.tsx`, `src/lib/util/routeFiles.ts` — the home page drop zone, file routing and the one-click demo (`/try`).
- `src/app/docs/*` with `DocsNav`, `DocPage` (breadcrumbs + TechArticle/BreadcrumbList JSON-LD) and `Breadcrumbs`; `SiteFooter.tsx` — the footer.
- `src/app/{faq,privacy,terms}/`, `robots.ts`, `sitemap.ts`, `manifest.ts`, `llms.txt/route.ts` — content, legal and SEO/GEO/AEO routes. Add new public pages to `sitemap.ts` and `llms.txt`.
- `src/components/VercelMetrics.tsx`, `AnalyticsOptOut.tsx`, `src/lib/util/privacy.ts` — measurement and its opt-out.
- `src/components/goals.ts` — the test options (plus `REVIEW_OPTION`) and exactly what each needs. The Program step, Compare step, Guide and landing page all read from it; change requirements there, not in copy scattered across pages.
- `src/lib/tb/testbench.ts` — testbench + GHDL/ModelSim scripts.
- `src/lib/session/` — `Session` type, validation, share links, `analyze()` pipeline.
- `src/components/SessionProvider.tsx` — client state, persistence, share import, waveform and final-value state. It wraps every page (root layout), so `/review` and the workbench share the depth and compile order.
- `src/components/steps-ui/*Step.tsx` — one component per workflow step; routes in `src/app/workbench/*/page.tsx` only render them.

## Domain facts worth knowing

- The reference RTL loads PC from M[0] during reset on a falling-then-rising clock edge pair; testbenches must hold reset across both.
- `in_port` is latched at fetch, so the testbench drives it combinationally from the fetch PC (`pc_out`), mirrored through a VHDL-2008 external name into a local signal (GHDL rejects external-name aliases in sensitivity lists).
- Hardware vs model comparison is by **sequence of distinct values** per channel, not by cycle.
- Known RTL findings (see README) are expected results in `compare.test.ts` and `review.test.ts`; don't "fix" the tests to make them pass.
- On the reference RTL, the 6-stage estimate for OneOperand.asm (full forwarding) equals the 17 cycles GHDL takes; `compare.test.ts` pins that.
- The NOP/immediate-word slot after some instructions hides part of a hazard, so hand-computed stall counts are often off by one; derive expectations from small programs and check them with `estimateTiming`.
- The review's compile order is verified by actually compiling with GHDL in `ghdl.integration.test.ts`.

## License

MIT (see `LICENSE`, also rendered at `/license`). Keep the copyright notice intact.

## Working style

- Make the smallest change that solves the problem; keep `src/lib` free of React.
- Add or update a test with every behaviour change.
- When running a production server locally for checks, stop it before rebuilding: `next build` replaces `.next/` underneath a running server and it starts serving 404s for new asset hashes.
- Finish with `npm run check` (and `npm run test:e2e` if you touched UI).
