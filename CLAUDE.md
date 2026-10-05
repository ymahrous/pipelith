# CLAUDE.md

@AGENTS.md

The shared agent instructions above apply in full. Notes specific to Claude Code:

- Start a task by running `npm test` to confirm a green baseline (≈2 s).
- Prefer editing `src/lib/**` with a failing test first; it is pure TypeScript and fast to iterate on.
- For UI changes, verify visually: `npm run build && npx next start -p 3100`, then screenshot with Playwright at 1366×900 and 390×844. Look for horizontal overflow and console errors (CSP violations appear there).
- Killing a background `next start` started via `npx` does not stop its `next-server` child; stop it with `pgrep -f "^next-server"` before rebuilding.
- Don't commit `public/samples/*.vcd.gz` changes unless the RTL changed; regenerate them only with the documented command in CONTRIBUTING.md.
- When you add or change a code review rule, run `npx vitest run src/lib/review` and read the reference-processor findings it prints on failure — check each new finding against the RTL source before trusting it.
- Test both pipeline depths **and** at least full / partial / no forwarding when touching timing, signal mapping or review pipeline checks.
- Locally `VERCEL` is unset, so no analytics scripts load; to check the Vercel path build with `VERCEL=1` — the `/_vercel/*` scripts then 404 locally, which is expected. The e2e suite asserts no `/_vercel` requests without it.
- After changing user-visible behaviour, check whether `/faq` (`src/lib/content/faq.ts`), `/guide`, `/privacy` or `llms.txt` now say something untrue.
- After adding or renaming a review rule, add it to `src/lib/review/rules.ts` and run `npx vitest run src/lib/review/rules.test.ts`.
- When a change adds a step for the user, look for a way to remove one: a default, an auto-load, a link that lands on the right page with the data open.
- Keep copy in the UI plain and in sentence case; buttons say what they do ("Download hardware kit (.zip)", not "Submit").
