# Pipelith constitution

**Version 1.0.0 · ratified 12 October 2026**

This document states what Pipelith is for and the principles every change must keep. It takes precedence over [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md), [CONTRIBUTING.md](CONTRIBUTING.md) and any other guidance: if they disagree, this file wins and the others are fixed. It applies equally to people and to AI coding agents.

## Purpose

Pipelith helps students and engineers find where a pipelined RISC processor stops agreeing with its instruction set — in VHDL, Verilog or SystemVerilog — and learn why. It reviews the code, runs programs on a reference model, shows what a correct pipeline should do, and compares the real design against it. It is free, needs no account and runs in the browser.

## Principles

### I. Your files never leave your device

- All processing — reviewing, assembling, simulating, generating kits, waveforms, prompts and reports — **must** happen in the browser. The server only delivers the app. There is no backend logic, database or account.
- The app **must not** contact third-party origins: no CDNs, remote fonts, trackers or embedded services. The only measurement is the cookieless Vercel Web Analytics and Speed Insights, behind `metricsEnabled()`, with URL scrubbing and the visitor's opt-out, Do Not Track and Global Privacy Control honoured.
- Nothing the visitor opens, types or generates is ever sent anywhere by Pipelith — including prompts for AI assistants, which the visitor copies themselves.

*Why:* processor designs are coursework, research and product IP. Trust is the precondition for anyone uploading them.

### II. Results must be true

- The **reference model defines the instruction set**; when hardware disagrees, that is a finding, not a model bug. Ambiguities in the specification become explicit options, never silent choices.
- The assembler stays bit-identical to the original `assembler.py`.
- A code review **error** means a compiler, elaborator or simulator will reject the code, or the result is certainly wrong. Anything heuristic is a warning or a note. Every rule is checked against the bundled reference designs (zero errors) before it ships, and new Verilog rules against real open-source designs.
- Estimates (pipeline timing, expected waveforms) say that they are estimates. Generated files are deterministic.

*Why:* a tool that cries wolf teaches people to ignore it; a tool that is quietly wrong teaches them the wrong thing.

### III. Every designer is welcome

- The site **must** meet WCAG 2.2 level AA: full keyboard use, visible focus, text contrast of at least 4.5:1 and control boundaries of at least 3:1 in every theme, reflow at 320 px, text resizable to 200%, nothing conveyed by colour alone, status changes announced to screen readers, no time limits, nothing that flashes.
- Visitors can choose light or dark colours, larger text, a high-legibility typeface and reduced motion, and those choices apply before the first paint.
- Write for a first-year student: plain language, sentence case, every term defined in the glossary, a Getting started path, and error messages that say what to do next.
- VHDL, Verilog and SystemVerilog are equals. Every language-specific feature — the hardware kit, the sample codebase, documentation examples, review rules — exists for each, or says plainly why not.
- Conformance is stated honestly: until an independent audit, the accessibility statement says *partially conformant*.

*Why:* the people who most need a patient, explicit tool are the ones just starting out, and the ones the usual tools leave behind.

### IV. Fewer steps, no surprises

- Prefer a good default, an automatic load or a link that lands on the right page with the data open over another instruction. When a change adds a step for the visitor, look for one to remove.
- Never silently replace work the visitor created; ask first.
- One control per setting: the design language is chosen with the HDL picker (and the language tabs that mirror it); depth and forwarding only through the pipeline settings.
- Buttons say what they do ("Download hardware kit (.zip)", not "Submit").

### V. Secure by default

- A strict, nonce-based Content-Security-Policy with no `'unsafe-inline'` or `'unsafe-eval'` in production. No inline styles.
- No raw HTML or code evaluation. The only exceptions are the two audited components that emit constant, nonce-tagged scripts (`JsonLd`, `DisplayScript`); a test keeps the list at exactly those two.
- Every untrusted input — files, archives, waveforms, share links, browser storage — goes through bounded parsers and field-by-field validation. Generated VHDL, Verilog, shell and Tcl only receive allow-listed identifiers, paths and clamped numbers.

### VI. One source of truth

Pipeline geometry lives in `pipeline.ts`; forwarding in the session; languages in `hdl.ts`; review rules in `rules.ts`; FAQ, docs map, glossary and troubleshooting in `src/lib/content`; the product name, URL, operator and legal dates in `site.ts`. Pages read these; they never copy them.

### VII. Honest words

The legal pages, the accessibility statement, the docs, `llms.txt` and the README describe what the software actually does today. A change to behaviour updates them in the same change. Pipelith gives no legal advice; operators of their own copy adapt the legal pages to their jurisdiction.

### VIII. Tests prove behaviour

Every behaviour change comes with a test. The suite covers both pipeline depths and full, partial and no forwarding wherever timing is involved; both reference designs round-trip through a real simulator; the end-to-end tests fail on any console or CSP error and on horizontal scrolling at phone width.

### IX. Open and free

Pipelith is MIT-licensed and free to use. Bundled fonts, designs and programs carry compatible licenses and are attributed on the `/license` page.

## Standards Pipelith follows

| Area | Standard |
| --- | --- |
| Hardware languages | IEEE 1076-2008 (VHDL), IEEE 1364-2005 (Verilog), IEEE 1800-2017 (SystemVerilog) |
| Waveforms | IEEE 1364 value change dump (VCD) |
| Accessibility | W3C WCAG 2.2 level AA (the basis of EN 301 549, Section 508 and similar laws), WAI-ARIA Authoring Practices for widgets |
| Privacy | GDPR and UK GDPR, ePrivacy, CCPA/CPRA (Global Privacy Control), LGPD, PIPEDA and comparable laws: no personal data collected beyond hosting logs and cookieless counts |
| Search and answer engines | Semantic HTML, canonical URLs, sitemap, robots.txt, schema.org JSON-LD, Open Graph, [llms.txt](https://llmstxt.org) |
| Web security | Content-Security-Policy Level 3 with nonces, HSTS, a deny-by-default Permissions-Policy |

## Governance

- **Amending.** Change this file in a pull request that explains why, update every document that depends on the change, and bump the version: **major** when a principle is removed or redefined, **minor** when one is added or materially extended, **patch** for wording.
- **Compliance.** Reviews check changes against these principles; the PR checklist in CONTRIBUTING.md mirrors them. A change that cannot meet a principle needs an amendment first, not an exception in code.
- **Precedence.** Constitution, then AGENTS.md (with CLAUDE.md), then CONTRIBUTING.md, then comments in code.
