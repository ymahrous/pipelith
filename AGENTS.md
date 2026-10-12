# AGENTS.md

Instructions for AI coding agents working in this repository. Humans: see CONTRIBUTING.md.

**Read [CONSTITUTION.md](CONSTITUTION.md) first.** It states the principles every change must keep (privacy, true results, accessibility, language parity, security, one source of truth) and takes precedence over this file.

## What this is

**Pipelith** — a Next.js 16 app (App Router, React 19, TypeScript strict) for validating pipelined RISC processors (5 or 6 stages, configurable forwarding) written in **VHDL, Verilog or SystemVerilog**: assembler → reference ISA model → pipeline timing estimate and expected waveform → comment-derived checks → VCD / final-value comparison → report, plus a static **code review** of an uploaded codebase in any of the three languages (with an AI-assistant prompt when the upload is badly structured). **Everything runs in the browser; there is no backend logic.** Keep it that way.

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
npx vitest run src/lib/icarus.integration.test.ts   # Verilog/SV round trip (runs when iverilog is installed; Verilator too if present)
node scripts/build-reference.mjs [--zip|--check]    # regenerate / check the SystemVerilog reference copy and sample zips
```

## Next.js 16 specifics

This is not the Next.js in most training data. Read `node_modules/next/dist/docs/` before using an API you are unsure of.

- Request interception lives in **`src/proxy.ts`** exporting `proxy()` (the old `middleware.ts` convention is deprecated).
- `next lint` no longer exists; use `npm run lint`.
- The root layout awaits `headers()` so every page renders per request — required for the CSP nonce. Do not make pages static.
- Fonts are self-hosted with `next/font/local` from `src/app/fonts/` (Recursive; Atkinson Hyperlegible for the high-legibility option). Never load fonts from a CDN.

## Hard rules

1. **No inline styles.** The CSP has no `'unsafe-inline'` for styles, so React `style={…}` props break in production. Add classes to `src/app/globals.css`. SVG presentation attributes (`fill`, `stroke`, `x`) are fine; `var(--x)` inside SVG attributes is not — use a CSS class.
2. **No raw HTML or eval.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`. ESLint enforces it. The only exceptions are `components/JsonLd.tsx` and `components/DisplayScript.tsx` (constant, nonce-tagged scripts); `security.test.ts` fails if a third file appears.
3. **No third-party origins.** No CDNs, remote fonts or extra trackers; `connect-src` is `'self'`. The only measurement is Vercel Web Analytics + Speed Insights in `src/components/VercelMetrics.tsx`, served same-origin. It is rendered **only** when `metricsEnabled()` (`src/lib/site.ts`: `VERCEL=1` and not `NEXT_PUBLIC_DISABLE_ANALYTICS=1`), and every `beforeSend` must keep `analyticsBlocked()` and `scrubUrl()` (`src/lib/util/privacy.ts`). Never send user content, query strings or the URL fragment — that includes AI prompts, which are only copied or downloaded. If you change what is measured, update `/privacy` and `SECURITY_AUDIT.md`.
4. **Assembler output is frozen.** `assemble()` must produce exactly what `assembler.py` produces; fixtures in `src/lib/__fixtures__/` enforce it.
5. **Validate untrusted input.** Files, zips, VCDs, share links and localStorage go through bounded parsers and `parseSession` / `parseDisplay`. Lookups keyed by user strings use `Map` or own-property checks, never plain object indexing. Zip entries are inflated with a streaming size cap (`review/intake.ts`); Verilog macro expansion and `include inlining are bounded (`review/verilog/lexer.ts`).
6. **Generated VHDL/Verilog/shell/Tcl only receives allow-listed values** (`safeIdent`, `safeFileName`, `safeRelPath`) or clamped numbers.
7. **Clamp numbers with `Math.floor` + range checks**, never `| 0` (it truncates to 32 bits).
8. **Code review errors must be real.** The VHDL reference-processor test in `review.test.ts` requires 0 errors, and `verilog.test.ts` requires the bundled Verilog and SystemVerilog reference designs to give 0 errors and 0 warnings. A new rule that adds one is a false positive. Use warning/info for anything heuristic. Check new Verilog rules against real open-source designs (PicoRV32, SERV, Ibex …) before trusting them.
9. **Never hard-code stage names.** Read `geometry(depth)` from `src/lib/pipeline/pipeline.ts`.
10. **Forwarding comes from the session.** Timing, verdicts, testbench notes, expected waveforms, reports and review rules take `session.forwarding` (`ForwardingConfig`) and use `activePaths()` / `hazardStall()` / `describeForwarding()`. Don't assume full forwarding; default parameters exist only for old call sites and tests.
11. **One control per setting.** Depth and forwarding are edited only through `PipelineSettings` (`src/components/DepthPicker.tsx`). The design language is edited only through `HdlPicker` (header) and `HdlTabs` (docs), both via `withHdl()`. Don't add another picker.
12. **The language comes from the session.** `session.hdl` (`src/lib/hdl.ts`) picks the testbench language (`generateTestbench({ hdl })`), the sample codebase, the .zip guide and docs examples. Code review reads every language it finds regardless. Every language-specific feature must exist for VHDL, Verilog and SystemVerilog (constitution III).
13. **The name has one source.** The product is **Pipelith** (tagline: *Pipeline verification for RISC processors*). UI, metadata and JSON-LD read `SITE.name` / `SITE.tagline`, generators in `src/lib` read `BRAND` (`src/lib/site.ts`). Don't hard-code the name. The logo mark is drawn in both `src/app/icon.svg` and `src/components/Brand.tsx`; change them together and regenerate `apple-icon.png` and the Open Graph/Twitter images. localStorage keys use the `pipelith:` prefix; `src/lib/util/storage.ts` migrates the old `processor-workbench:` keys once.
14. **Program changes go through `withProgram()`** (`src/lib/session/session.ts`). It keeps the design settings (`stages`, `forwarding`, `hdl`, `compileOrder`, `rtlRoot`, model options) and resets everything about the program. Never rebuild a session by hand with `emptySession()` + a list of fields — that is how settings got lost before.
15. **Review rules are documented.** Every `rule:` id emitted by `vhdl.ts`, `verilog/review.ts` or `review.ts` must have an entry in `src/lib/review/rules.ts` with the same category and the languages that emit it; `rules.test.ts` fails otherwise. `/docs/review-rules` and the findings' "About this rule" links read it.
16. **Docs live in content files.** The docs sidebar, hub, sitemap and llms.txt read `src/lib/content/docs.ts`; glossary and troubleshooting text live in `glossary.ts` / `troubleshooting.ts`. Troubleshooting titles quote real UI messages and labels — grep for them before writing. The `/docs/checks` example is `content/checksExample.ts` and must keep passing every check.
17. **Fewer steps, no surprises.** Shortcuts (`useQuickStart`: dropped files, `/try` demo) may navigate and load data, but must never silently replace a program the visitor wrote — ask first, as `/try` does. Files cross pages only through the provider's in-memory `setHandoff`/`takeHandoff`.
18. **Content has one source.** FAQ text lives in `src/lib/content/faq.ts` (feeds `/faq` and its `FAQPage` JSON-LD); site name, URL, operator and legal dates in `src/lib/site.ts`. JSON-LD goes through `src/components/JsonLd.tsx` (nonce + `<` escaping) — never a raw `<script>`.
19. **Accessibility is a requirement (WCAG 2.2 AA).** Text colours keep 4.5:1 and control borders 3:1 in both themes (`--ink-3`, `--control-border`, `--focus`, `--accent-control` in `globals.css` — re-check contrast if you change a token). Tabs use the keyboard pattern in `ReviewPage`'s `Tabs` / `HdlTabs`; status changes go through `toast()` (announced); never convey state by colour alone; pages must not scroll sideways at 320 px. Display preferences (`pipelith:display`) are applied before paint by `DISPLAY_SCRIPT`, which must stay in step with `parseDisplay()` (`display.test.ts`).
20. **Reference designs.** `reference/verilog/rtl` is the source of the 5-stage Verilog design; `reference/systemverilog` is generated from it by `scripts/build-reference.mjs` — never edit it by hand. After changing the Verilog design: run the script (`--zip` to rebuild the sample zips), then `UPDATE_SAMPLES=1 npx vitest run src/lib/icarus.integration.test.ts` to refresh `public/samples/verilog/*.vcd.gz`.

## Where things are

- `src/lib/hdl.ts` — the three languages (labels, standards, extensions, simulators), `toHdl`, `hdlOfPath`.
- `src/lib/isa/` — `ProcessorProfile` type and the `risc6` profile (the single source of truth for encoding, docs page and hardware binding, including the Verilog binding: `intr` port and file list).
- `src/lib/asm/` — assembler (`assembler.ts`), `.mem` import + disassembler (`memfile.ts`).
- `src/lib/sim/simulator.ts` — reference model; `stateAt()` replays state for the step scrubber.
- `src/lib/check/expectations.ts` — comment → `Check` parser, evaluator, IN-value inference.
- `src/lib/vcd/parser.ts` — streaming VCD parser.
- `src/lib/compare/compare.ts` — `autoMap()` signal discovery, `compareTrace()` sequence comparison, `judgeTiming()`.
- `src/lib/compare/finalValues.ts` — parser/comparison for typed final register values (the no-waveform option).
- `src/lib/pipeline/pipeline.ts` — `geometry(5|6)`, `ForwardingConfig` / `FULL_FORWARDING` / `NO_FORWARDING`, `hazardStall()`, `estimateTiming()`.
- `src/lib/wave/expected.ts` — the expected waveform (VCD) for a run, from the model and the timing estimate.
- `src/lib/review/` — `intake.ts` (zip/folder/files → sources, limits), `common.ts` (findings, design units), `review.ts` (orchestrator + design-level checks: hierarchy, compile order, pipeline), `vhdl.ts` + `lexer.ts` + `parse.ts` (VHDL), `verilog/lexer.ts` (lexer + preprocessor), `verilog/parse.ts`, `verilog/review.ts` (Verilog/SystemVerilog rules), `rules.ts` (catalog), `structure.ts` (post-upload structure check), `aiPrompt.ts` (restructuring prompt), `report.ts` (Markdown).
- `src/lib/tb/testbench.ts` — testbench + scripts: VHDL (GHDL, ModelSim) and Verilog/SystemVerilog (Icarus, Verilator, ModelSim).
- `src/lib/session/` — `Session` type, validation, `withProgram`, `withHdl`, share links, `analyze()` pipeline.
- `src/lib/util/display.ts` — display preferences and the pre-paint script.
- `src/components/review/ReviewPage.tsx` — the `/review` page (structure check, language notice, AI prompt, tabs); `ZipGuide.tsx` (per-language .zip guide, also in `/guide#zip`); `AiPromptPanel.tsx`.
- `src/components/HdlPicker.tsx`, `HdlTabs.tsx`, `DisplayMenu.tsx`, `DisplayScript.tsx` — header tools and language tabs.
- `src/components/DepthPicker.tsx` (`PipelineSettings`), `PipelineTiming.tsx`, `ExpectedWaveButton.tsx`, `WaveformLibrary.tsx` — depth/forwarding, timing diagram, expected waveforms.
- `src/components/QuickStart.tsx`, `useQuickStart.ts` (also `SAMPLE_DESIGNS`), `TryDemo.tsx`, `src/lib/util/routeFiles.ts` — drop zone, routing, demo.
- `src/app/docs/*` with `DocsNav`, `DocPage`, `Breadcrumbs`; `/docs/start` (Getting started), `/waveforms`, `/accessibility`; `SiteFooter.tsx`.
- `src/app/{faq,privacy,terms,accessibility}/`, `robots.ts`, `sitemap.ts`, `manifest.ts`, `llms.txt/route.ts` — content, legal and SEO/GEO/AEO routes. Add new public pages to `sitemap.ts` and `llms.txt`.
- `src/components/VercelMetrics.tsx`, `AnalyticsOptOut.tsx`, `src/lib/util/privacy.ts` — measurement and its opt-out.
- `src/components/goals.ts` — the test options (plus `REVIEW_OPTION`) and exactly what each needs.
- `src/components/SessionProvider.tsx` — client state, persistence, share import, waveform and final-value state. It wraps every page **including the header and footer**, so the HDL picker, `/review` and the workbench share depth, language and compile order.
- `src/components/steps-ui/*Step.tsx` — one component per workflow step; routes in `src/app/workbench/*/page.tsx` only render them.
- `reference/` — the 5-stage Verilog reference design and its generated SystemVerilog copy; `scripts/build-reference.mjs`.

## Domain facts worth knowing

- The reference RTL loads PC from M[0] during reset on a falling-then-rising clock edge pair; testbenches must hold reset across both.
- `in_port` is latched at fetch, so the testbench drives it combinationally from the fetch PC (`pc_out`) — in VHDL through a VHDL-2008 external name mirrored into a local signal (GHDL rejects external-name aliases in sensitivity lists), in Verilog through the hierarchical reference `uut.pc_out`.
- The Verilog/SystemVerilog kit expects the interrupt input to be called `intr` (SystemVerilog reserves `int`).
- Hardware vs model comparison is by **sequence of distinct values** per channel, not by cycle.
- Known RTL findings of the 6-stage VHDL design (see README) are expected results in `compare.test.ts` and `review.test.ts`; don't "fix" the tests to make them pass. The 5-stage Verilog design matches the model on all four tests.
- On the reference RTL, the 6-stage estimate for OneOperand.asm (full forwarding) equals the 17 cycles GHDL takes; `compare.test.ts` pins that. The 5-stage Verilog design hits the 5-stage estimate exactly on OneOperand and TwoOperand.
- The bundled sample waveform follows the depth: 6 stages → the VHDL design in GHDL (`public/samples/*.vcd.gz`), 5 stages → the Verilog design in Icarus (`public/samples/verilog/*.vcd.gz`).
- Expected waveforms change registers and OUT at write-back, flags at execute (branch flags where branches resolve, RTI in memory), SP and memory writes in the memory stage.
- The NOP/immediate-word slot after some instructions hides part of a hazard, so hand-computed stall counts are often off by one; derive expectations from small programs and check them with `estimateTiming`.
- The review's VHDL compile order is verified by compiling with GHDL in `ghdl.integration.test.ts`; Verilog compile orders put packages first and leave out `include-only headers.

## License

MIT (see `LICENSE`, also rendered at `/license`). Keep the copyright notice intact. Fonts are SIL OFL 1.1 (`src/app/fonts/`).

## Working style

- Make the smallest change that solves the problem; keep `src/lib` free of React.
- Add or update a test with every behaviour change.
- When running a production server locally for checks, stop it before rebuilding: `next build` replaces `.next/` underneath a running server and it starts serving 404s for new asset hashes.
- Finish with `npm run check` (and `npm run test:e2e` if you touched UI).
