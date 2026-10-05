# Contributing

Thanks for helping with Pipelith. This guide covers setup, the rules the code follows, how to add a review rule, and how to add support for another processor.

## Setup

```bash
git clone <this repo> && cd pipelith
npm install
npm run dev
```

Node.js 20.9+ (see `.nvmrc`). For the optional hardware round-trip test, install [GHDL](https://github.com/ghdl/ghdl) 4.x and clone the reference processor.

## Before you open a pull request

```bash
npm run check          # typecheck, lint, unit tests, production build
npm run test:e2e       # Playwright, desktop + mobile
```

If you touched the testbench generator, the comparison, the compile-order logic in Code review, or a profile's hardware binding, also run:

```bash
RTL_DIR=../risc-pipelined-processor/src/rtl npm test
```

PR checklist:

- [ ] Tests cover the change (unit tests next to the code in `src/lib/**`, or an e2e flow in `e2e/`).
- [ ] No new third-party runtime requests, scripts or fonts. Vercel analytics stays behind `metricsEnabled()` with URL scrubbing and the opt-out.
- [ ] No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, or React `style={…}` props (the CSP forbids inline styles — add a class in `globals.css`).
- [ ] New inputs from files, links or storage are validated and size-limited.
- [ ] UI copy is plain, sentence case, and names actions by what they do.
- [ ] `SECURITY_AUDIT.md` and `/privacy` are updated if you changed headers, the CSP, limits, or what leaves the browser.
- [ ] `/faq`, `/guide` and `llms.txt` still describe the app correctly; new public pages are in `sitemap.ts`.

## Architecture rules

- **`src/lib` is pure TypeScript** with no React or DOM imports (except the small `util/download.ts`, `vcd/parser.ts › parseVcdFile` and `review/intake.ts › readFileList`). It must run under Node for tests.
- **`analyze(session)`** (`src/lib/session/analyze.ts`) is the single pipeline from session to assembly, simulation, check results and timing estimate. The UI memoises it; tests call it directly.
- **Pipeline depth lives in one place:** `src/lib/pipeline/pipeline.ts › geometry(depth)`. The timing model, the Guide's comparison table, the ISA page, the testbench header and the review's pipeline checks all read from it. Add a depth there, not in the UI.
- **Forwarding is a session setting.** `session.forwarding` (`ForwardingConfig`: `enabled`, `paths` = `"all"` or a list of pipeline-register names, `writeThrough`) feeds `estimateTiming`, `judgeTiming`, the testbench note, reports and `reviewCodebase`. The UI edits it only via `PipelineSettings`.
- **Design settings survive program changes.** `stages`, `forwarding`, `compileOrder` and `rtlRoot` describe the design under test; loading a new program must keep them.
- **Content in one place.** FAQ entries in `src/lib/content/faq.ts`; site URL, operator and legal dates in `src/lib/site.ts`; structured data via `components/JsonLd.tsx`.
- **The assembler must stay bit-compatible with `assembler.py`.** The fixtures in `src/lib/__fixtures__/*.mem` were produced by the Python tool; the tests compare against them. Add diagnostics freely, but never change the emitted words.
- **The reference model defines the ISA, not the RTL.** If the RTL disagrees, that is a finding. Ambiguities in the spec become `ModelOptions`, not silent choices.
- **Untrusted data** (files, VCDs, share links, localStorage) is parsed by bounded code and validated field by field — see `parseSession`.
- **Generated code** (VHDL, shell, Tcl) only receives values that pass `safeIdent`, `safeFileName` or `safeRelPath`, or numbers.

## Tests

| Where | What |
| --- | --- |
| `src/lib/asm/assembler.test.ts` | Python compatibility, encoding, diagnostics |
| `src/lib/sim/simulator.test.ts` | Instruction semantics, flags, stack, interrupts, limits |
| `src/lib/check/expectations.test.ts` | Comment parsing, bundled programs |
| `src/lib/vcd/parser.test.ts` | Parser correctness, chunk boundaries, bad input |
| `src/lib/compare/compare.test.ts` | Comparison on the real GHDL samples |
| `src/lib/compare/finalValues.test.ts` | Final-register-values parser and comparison |
| `src/lib/pipeline/pipeline.test.ts` | 5/6-stage geometry, stall and cycle estimates, full/partial/no forwarding, write-through |
| `src/lib/review/review.test.ts` | Lexer, every review rule on small VHDL cases (incl. forwarding settings and missing packages), the reference processor, zip intake |
| `src/lib/misc.test.ts` | Profiles, session validation (incl. forwarding), `withProgram`, reports, privacy helpers, storage migration, the `/docs/checks` example |
| `src/lib/review/rules.test.ts` | The rule catalog matches the engine's rules and categories |
| `src/lib/util/routeFiles.test.ts` | Quick-start routing of dropped files |
| `src/lib/security.test.ts` | ReDoS, size limits, zip bombs, injection, validation |
| `src/lib/ghdl.integration.test.ts` | Opt-in: GHDL compiles in the review's order, and every program round-trips (`RTL_DIR`) |
| `e2e/workbench.spec.ts` | Full user flows, one-click demo, quick start routing, docs pages, nav and footer, forwarding settings in every scan, zip guide, legal/FAQ pages and opt-out, SEO endpoints, headers, mobile layout, console errors |

Refresh the sample waveforms after an RTL change:

```bash
RTL_DIR=../risc-pipelined-processor/src/rtl UPDATE_SAMPLES=1 npx vitest run src/lib/ghdl.integration.test.ts
```

Rebuild the sample codebase used by *Try the reference processor*:

```bash
cd .. && zip -9 -r pipelith/public/samples/reference-rtl.zip risc-pipelined-processor/src/rtl risc-pipelined-processor/testcases -i "*.vhd" "*.asm"
```

Regenerate the bundled programs from the processor repo:

```bash
node scripts/sync-examples.mjs ../risc-pipelined-processor/testcases
```

## Adding a code review rule

Rules live in `src/lib/review/review.ts`; the parser in `parse.ts` gives you entities, ports, declarations, processes (as statement trees), concurrent assignments and instances.

1. Decide the category (`Syntax`, `Structure`, `Connectivity`, `Processes`, `Pipeline`, `Style`) and severity: **error** only when a compiler, elaborator or simulator will fail or the result is certainly wrong; **warning** for likely bugs; **info** for suggestions.
2. Call `add({ rule, category, severity, file, line, title, message, fix, fixCode? })`, and add the rule to the catalog in `src/lib/review/rules.ts` (title, why, fix, usual severity) — `rules.test.ts` fails until you do, and `/docs/review-rules` shows it. The title says what is wrong; the message says why it matters; the fix says what to do — with code when it helps.
3. Group findings that can fire many times per architecture (see `unread-signal`) into one.
4. Add a small failing VHDL case to `review.test.ts`, and run the reference-processor test: it must still report **0 errors** — every new error on real, working RTL is a false positive.
5. Depth-specific checks read `geometry(depth)`; forwarding-specific checks read the `forwarding` argument via `activePaths()`. Never hard-code stage names.
6. If the rule changes what a correct upload must contain, update `ZipGuide.tsx` and the README's *Structuring the .zip*.

## Adding a processor profile

A profile (`src/lib/isa/profile.ts › ProcessorProfile`) describes one ISA and how to drive its RTL.

1. Create `src/lib/isa/<id>.ts` exporting a `ProcessorProfile`: memory size, register count, SP reset value, vectors, the instruction table (mnemonic, opcode, operand kind, words, flags, summary), default `ModelOptions`, `supportedDepths` / `defaultDepth`, and the `hardware` binding (entity, port and internal signal names, `flagsCandidates` per depth, reset polarity, clock period, default VHDL compile order).
2. Register it in `PROFILES` in `src/lib/isa/risc6.ts` (or move the registry into its own file when there are several).
3. If the encoding differs from `[31:27] opcode | [26:24] Rsrc1 | [23:21] Rsrc2 | [20:18] Rdst | [17:16] index`, generalise `encodeInstruction` and `decodeWord` behind the profile rather than forking them.
4. If semantics differ, extend `simulate()` with profile-driven behaviour and add tests for every instruction you touch.
5. If its multi-cycle instructions or stall rules differ, extend `geometry()` rather than special-casing the timing model.
6. Add the profile's test programs to `src/lib/examples/` and a GHDL run to the integration test.

## Design notes

The palette, type scale and components live in `src/app/globals.css` as CSS custom properties, with dark-mode values under `prefers-color-scheme`. The pipeline stepper is the one distinctive element; keep the rest quiet. Check layouts at 390 px wide — the e2e suite fails on horizontal scrolling.

## Documentation pages

User docs live in the app, not in this repository: `/docs` (hub), `/docs/checks`, `/docs/review-rules`, `/docs/troubleshooting`, `/docs/glossary`, plus `/guide`, `/isa` and `/faq`. Add a page under `src/app/docs/<slug>/page.tsx` using `DocPage`, register it in `src/lib/content/docs.ts` (sidebar, hub, llms.txt) and `src/app/sitemap.ts`, and add it to the narrow-screen e2e test. Write answer-first: the first sentence of each section should answer the question on its own.

## Brand

The product name, tagline and operator live in `src/lib/site.ts` (`BRAND`, `SITE`). The mark — four instructions stepping through a pipeline, the last in amber — is drawn in `src/app/icon.svg` and `src/components/Brand.tsx` (keep them identical). After changing it, regenerate `src/app/apple-icon.png` (180×180) and `src/app/opengraph-image.png` / `twitter-image.png` (1200×630) by screenshotting them with Playwright, and update the `.alt.txt` files. Colours: teal `#123f3e`, silkscreen `#9cbdb5`, amber `#e3a21a`.

## Legal pages and FAQ

The privacy policy and terms describe the software's real behaviour. If a change affects data handling (storage keys, measurements, anything sent over the network), update `src/app/privacy/page.tsx` and bump `legalUpdated` / `legalUpdatedText` in `src/lib/site.ts`. Forks that deploy their own copy must replace the operator and contact details.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).

## Code of conduct

Be kind and specific. Critique code, not people.
