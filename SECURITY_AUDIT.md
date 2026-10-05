# Security audit — Pipelith

| | |
| --- | --- |
| Version audited | 0.4.0 (Next.js 16.3.8, React 19.3.0) — adds the quick-start drop zone, one-click demo (`/try`) and documentation pages; 0.3.0 added forwarding settings, .zip structure guide, Vercel Web Analytics + Speed Insights, privacy/terms/FAQ pages and SEO/GEO/AEO endpoints (0.2.0 added Code review and 5/6-stage support) |
| Date | 5 October 2026 |
| Scope | All application code in `src/`, `next.config.ts`, `src/proxy.ts`, codebase intake (zip/folder/files), generated artefacts (testbench, scripts, ZIP, reports, share links), analytics integration, structured data, metadata routes (`robots`, `sitemap`, `manifest`, `llms.txt`, OG images), dependencies |
| Method | Threat modelling, manual code review, adversarial unit tests (`src/lib/security.test.ts`), end-to-end header and console checks (`e2e/`), `npm audit`, HTTP header inspection of a production build |
| Result | **No open high or medium findings.** Seven issues were found during the audits and fixed; residual risks are listed in §6. |

---

## 1. System overview

Pipelith is a Next.js app with **no backend logic**. The server renders pages and serves static assets; it has no API routes (the only route handler, `/llms.txt`, returns a static text file), no database, no authentication, no cookies and no outbound requests. When deployed on Vercel, the browser additionally sends cookieless page-view and Web Vitals events to Vercel's same-origin `/_vercel/*` endpoints (§3.5). All processing — assembling, simulating, estimating pipeline timing, parsing waveforms, comparing, unpacking and reviewing uploaded VHDL codebases, generating testbenches and reports — happens in the visitor's browser.

```
Browser (untrusted input enters here)                       Server
┌──────────────────────────────────────────────┐          ┌──────────────────────┐
│ .asm/.mem/.vcd/.zip/.vhd ─► parsers (bounded)│          │ proxy.ts: nonce + CSP│
│ share link (#s=…)  ─► inflate (capped) ─► validate       │ next.config: headers │
│ localStorage       ─► validate               │  GET     │ SSR of static UI     │
│ React UI (text only, no HTML injection)      │ ───────► │ /samples/*.vcd.gz    │
│ Generated: .mem, testbench, scripts, ZIP, MD │          │ robots/sitemap/llms  │
│ (Vercel only) page path + vitals ─► scrub ──►│ ───────► │ /_vercel/* (metrics) │
└──────────────────────────────────────────────┘          └──────────────────────┘
```

## 2. Threat model

| Asset | Threat | Actor |
| --- | --- | --- |
| Visitor's browser session | XSS via crafted program, VCD or share link | Someone who sends a link or file |
| Visitor's machine | Command injection through the generated `run_ghdl.sh` / `.do` script | Someone who sends a share link |
| Visitor's tab | Denial of service (ReDoS, memory exhaustion, decompression bomb, infinite loop) | Crafted file, zip, VHDL source or link |
| Visitor's code | Uploaded RTL sent somewhere, or rendered as markup | App itself |
| Visitor's data | Leakage of programs or waveforms to a server or third party | App itself, third-party scripts, referrers |
| Visitor's data | Share-link programs, query strings or identifiers reaching analytics | Analytics integration |
| UI integrity | Clickjacking, framing | Hostile site |
| Supply chain | Vulnerable or malicious dependencies | Upstream |

Out of scope: the security of the user's own RTL, GHDL/ModelSim, and the hosting platform.

## 3. Controls

### 3.1 Injection and XSS
- **No HTML rendering of untrusted text.** React escapes all output; `dangerouslySetInnerHTML`, `innerHTML`, `eval` and `new Function` do not appear anywhere (enforced by ESLint rules `react/no-danger`, `no-eval`, `no-implied-eval`, `no-new-func`).
- The code editor is a plain `<textarea>`, not `contenteditable`.
- Code review excerpts of uploaded VHDL are rendered as React text inside `<pre>`, never as HTML; file paths from archives are cleaned (`..`, `.` and empty segments removed) and used only as labels.
- Markdown reports escape table delimiters and newlines; they are downloaded as files, never rendered.
- **Strict CSP with a per-request nonce** (`src/proxy.ts`): `script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src 'self' 'nonce-…'` — no `'unsafe-inline'` and no `'unsafe-eval'` in production; `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`, `connect-src 'self'`. Verified by `e2e/workbench.spec.ts` and by asserting zero console errors (including CSP violations) through a full run.
- The UI uses no inline `style` attributes, so the CSP needs no `style-src-attr` exception.
- **Structured data (JSON-LD)** is emitted only by `src/components/JsonLd.tsx`: a `<script type="application/ld+json">` carrying the request nonce, with its JSON built from constants (`src/lib/site.ts`, `src/lib/content/faq.ts`, step lists) and every `<` escaped as `\u003c`, so no value can close the script element. No user input reaches it.
- **Vercel scripts and the CSP.** `@vercel/analytics` and `@vercel/speed-insights` inject `/_vercel/insights/script.js` and `/_vercel/speed-insights/script.js` from a nonce-tagged Next.js client component; `'strict-dynamic'` trusts scripts inserted by trusted scripts, and both are same-origin, so **the CSP was not loosened**. Their beacons go to the same origin, inside `connect-src 'self'`. Verified with a `VERCEL=1` production build: no CSP violations.

### 3.2 Generated code (testbench, scripts)
- Everything interpolated into VHDL or shell passes an allow-list: identifiers `^[A-Za-z][A-Za-z0-9_]{0,63}$`, file names `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, relative paths `^[A-Za-z0-9._/-]{1,256}$` with no `..` segment (`safeIdent`, `safeFileName`, `safeRelPath`).
- Numeric values (addresses, IN values, cycle counts, interrupt counts) are clamped integers rendered as hex/decimal literals.
- Shell variables are quoted (`"$RTL/…"`, `"${FLAGS[@]}"`) and the script runs with `set -euo pipefail`.
- The user-chosen program name only reaches file names through `slug()` (`[a-z0-9-]`, ≤ 48 chars), never file contents.
- Tested in `security.test.ts › generated testbench is injection-safe`.

### 3.3 Untrusted state (share links, localStorage)
- Share links live in the URL **fragment**, which browsers do not send to servers or in `Referer` headers.
- Token charset is checked (`^[A-Za-z0-9_-]+$`), length capped at 200,000 characters, and **inflation is capped at 4 MB** to defeat decompression bombs.
- Decoded JSON and stored sessions go through `parseSession`, which rebuilds a session field by field with type checks, ranges and length limits; unknown keys are dropped. The forwarding setting keeps only booleans and at most 8 path names matching `^[A-Z0-9]{2,4}/[A-Z0-9]{2,4}$`; a path list never reaches generated code except as a description in a sanitised testbench comment. Profile lookup uses a `Map`, so `__proto__`-style keys resolve to nothing.
- A share link never silently replaces open work: the user is asked first.

### 3.3a Quick start and demo
- Dropped files are routed by **file name only** (`routeFiles`); their contents are then read by the same bounded readers as the destination page (`readTextFile` size caps, `readFileList`/`readZip` limits, the streaming VCD parser). Routing grants nothing a direct upload wouldn't.
- Codebases cross from the home page to `/review` through an in-memory slot in the session provider (`setHandoff`/`takeHandoff`): never stored, never serialised, consumed once, gone on reload.
- `/try` only loads bundled samples from the same origin. It never replaces a program the visitor wrote without asking, and it is `noindex`.
- Documentation pages are static server-rendered content from constants; their JSON-LD goes through the same nonce-tagged, `<`-escaped `JsonLd` component.

### 3.4 Denial of service (all client-side)
| Input | Limit |
| --- | --- |
| Assembly source | 512 KB, 20,000 lines |
| `.mem` file | 2 MB, 4096 words |
| Simulation | 200,000 steps (hard cap), default 50,000 |
| VCD | 512 MB file, 200,000 declared signals, 2,000,000 changes per kept signal; streamed in chunks, only mapped signals stored |
| Share link | 200,000 chars, 4 MB inflated |
| Gzipped VCD | inflated on the fly; aborted past 512 MB of text |
| Final register values | 8 KB of text; names resolved by own-property lookup only |
| Code review .zip | 50 MB archive, 5,000 entries, 2 MB per inflated entry (enforced while streaming, so a lying size header can't bypass it), 40 MB total source, 1,500 VHDL files; encrypted and unknown-method entries skipped |
| Analytics opt-out flag | one fixed localStorage key, read as the literal `"1"` only |
| Legacy key migration | two fixed key pairs (`processor-workbench:*` → `pipelith:*`), copied verbatim once; the session is still validated by `parseSession` after the move, and existing new keys are never overwritten |
| Code review parsing | Lexer and block matcher are linear; statement parser has a progress guard; adversarial inputs (20,000 open parens, 50,000-char literals) are tested to finish in under 3 s |
| Checks / interrupts / IN values | 500 / 32 / 64 per address |

All regular expressions that touch user input were reviewed for catastrophic backtracking and fuzzed with 100,000-character pathological inputs (`security.test.ts › no catastrophic backtracking`, each case must finish in under 1.5 s; actual times are milliseconds).

### 3.5 Privacy and transport
- No cookies, advertising, CDNs or third-party fonts (fonts are self-hosted from npm packages). No third-party origin is contacted.
- **Measurement is minimised** (`src/components/VercelMetrics.tsx`, `src/lib/util/privacy.ts`):
  - rendered only when `VERCEL=1` and `NEXT_PUBLIC_DISABLE_ANALYTICS` is not `1` (`metricsEnabled()`); self-hosted copies emit no `/_vercel` requests (asserted in e2e);
  - `beforeSend` drops the event when Global Privacy Control, Do Not Track or the visitor's opt-out (`/privacy`) is set (`analyticsBlocked()`);
  - otherwise the URL is rebuilt as origin + path by `scrubUrl()`, removing the query string and the `#` fragment that carries share-link programs; unparsable URLs drop the event;
  - Vercel Web Analytics is cookieless and identifies visitors only by a daily-rotating request hash (Vercel's documentation); Speed Insights sends Web Vitals, path, device and browser.
  - No uploaded content, program, register value, finding or file name is ever passed to either library. Unit tests cover `scrubUrl` and `analyticsBlocked`.
- `/privacy` documents the above, both storage keys, hosting logs, legal bases, retention and rights; `/terms` covers acceptable use and warranty. Both must be adapted by anyone operating their own deployment.
- `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security` (2 years, preload), a deny-by-default `Permissions-Policy`, and `X-Powered-By` removed.
- No production source maps.

## 4. Findings fixed during the audit

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| F-1 | Medium | `PROFILES[id]` on a plain object meant a share link with `profileId: "__proto__"` resolved to `Object.prototype`, breaking the profile lookup and every later stage. | `PROFILES` is now a `Map`; lookups go through `getProfile()`. Regression test in `misc.test.ts`. |
| F-2 | Low | `maxSteps \| 0` truncated to 32 bits, so a huge step limit from a crafted link wrapped negative and the run stopped after one step (and could have bypassed the cap in other ways). | Finite-check, floor and clamp to `[1, 200000]`. Same fix for interrupt counts in the testbench. Test: `security.test.ts › caps simulation length`. |
| F-3 | Low | A share link pasted into an already-open workbench tab only changed the fragment, so it was ignored without notice. | Listen for `hashchange`; malformed links produce a visible message. Covered by e2e. |
| F-4 | Low (integrity) | Session saving was debounced only, so closing or reloading the tab within 300 ms lost the last edit (and a share link created right after could carry stale data). | Flush on `pagehide` / `visibilitychange`. Covered by e2e. |
| F-5 | Low (integrity) | Loading a program reset the whole session, silently discarding the selected pipeline depth and the compile order imported from Code review — the next hardware kit would then compile the wrong files or be sized for the wrong depth. | Design settings (`stages`, `forwarding`, `compileOrder`, `rtlRoot`) are carried over — `forwarding` was missed when it was introduced and fixed in 0.3.0. Covered by e2e. |
| F-6 | Low (privacy) | Vercel's default events include the full page URL; on `/workbench/*` the `#s=…` fragment could carry a share-link program, and query strings could carry anything. | `beforeSend` reduces every event URL to origin + path and drops events with GPC/DNT/opt-out. Tested in `misc.test.ts`. |
| F-7 | Low (integrity) | `use work.some_pkg` for a package missing from the upload was silently accepted, so an incomplete upload produced a misleadingly clean review and a compile order GHDL would reject. Conversely, vendor primitives (e.g. `unisim`) were reported as errors. | New `missing-package` error; `unknown-unit` is a warning when the file uses a non-`work`/`ieee`/`std` library; the post-upload structure check summarises both. Reference RTL still reports 0 errors. |

## 5. Dependency audit

`npm audit --omit=dev` (5 October 2026): **0 vulnerabilities** in production dependencies (`next`, `react`, `react-dom`, `@vercel/analytics` 2.x, `@vercel/speed-insights` 2.x, two `@fontsource-variable` font packages). The two Vercel packages are first-party, have no runtime dependencies of their own, and their scripts are served by the hosting platform from the site's own origin. Code review, zip reading and gzip support added no dependencies: they use the browser's `DecompressionStream`.

`npm audit` (including dev tools) reports `braces` (GHSA-vfj7-8cjw-p6xm, stack-exhaustion DoS via deeply nested brace patterns), pulled in by `eslint-config-next → fast-glob → micromatch`. No patched `braces` release exists, and npm's only suggested fix downgrades `eslint-config-next` to v14. **Accepted:** it runs only in the linter on this repository's own glob patterns, never on user input, and never ships to browsers. Re-check when `eslint-config-next` updates.

## 6. Residual risks and recommendations

1. **Dynamic rendering for nonces.** Every HTML request is rendered per request so the CSP nonce is fresh. Pages are small and render in milliseconds, but a CDN cannot cache HTML. If that becomes a problem, consider Next's experimental SRI hashing instead of nonces.
2. **Trusted Types** are not enforced (`require-trusted-types-for 'script'`). The app has no DOM-sink usage, so this would be defence in depth; enable it once the framework runtime is confirmed compatible.
3. **HSTS preload** is sent on every host. Remove `preload` if you deploy on a domain you do not intend to submit to the preload list, and note that HSTS has no effect over plain HTTP (localhost).
4. **Generated scripts run on the user's machine.** They are short, deterministic and allow-listed, and the UI says to read them before running. A hostile share link can still choose *which* hex values and cycle counts appear — harmless by construction, but users should run kits only for designs they trust.
5. **localStorage** is readable by any script on the same origin. Host the app on its own origin (not a subpath shared with other apps).
6. **Client-side DoS** is bounded but not eliminated: a 512 MB VCD or a 50 MB zip will still take several seconds and noticeable memory. That only affects the user who chose to open it.
7. **Analytics depends on the host.** What Vercel stores and for how long is governed by Vercel; the app controls only what it sends. Operators who need zero measurement set `NEXT_PUBLIC_DISABLE_ANALYTICS=1`.
8. **Code review is advisory.** It is static analysis with heuristics; a clean review is not proof of correctness, and the UI says so. The compile order it produces is checked against GHDL in CI.

## 7. Deployment checklist

- [ ] Serve over HTTPS on a dedicated origin.
- [ ] Keep `src/proxy.ts` active (it sets the CSP); confirm with `curl -sI https://<host>/workbench/program`.
- [ ] Do not add third-party scripts, analytics or fonts without updating the CSP, `/privacy` and this document.
- [ ] Set `NEXT_PUBLIC_SITE_URL` to the canonical origin (or rely on Vercel's production URL), and update the operator, contact and dates in `src/lib/site.ts` for your deployment.
- [ ] Decide on measurement: enable Web Analytics / Speed Insights in the Vercel dashboard, or set `NEXT_PUBLIC_DISABLE_ANALYTICS=1`.
- [ ] Run `npm audit --omit=dev` and `npm run check` before each release.
- [ ] Re-run `npx playwright test` — it fails on any CSP violation or console error.

## 8. Reporting

See [SECURITY.md](SECURITY.md).
