# Security policy

## Supported versions

Only the latest release on the default branch receives fixes.

## Reporting a vulnerability

Please report privately — do not open a public issue.

- Use GitHub's **Report a vulnerability** (Security → Advisories) on this repository, or
- email the maintainer listed in the repository profile.

Include what you found, steps or a file that reproduces it, and the impact you expect. You will get an acknowledgement within 5 working days and a fix or mitigation plan within 30 days for confirmed issues. Credit is given in the release notes unless you prefer otherwise.

## What counts

Anything that lets a file, archive, VHDL codebase, waveform or share link execute script, read or send another visitor's data, causes user content, a query string or a share-link fragment to reach analytics, run unexpected commands through a generated script, bypass the Content-Security-Policy, or lock up the app beyond the documented limits (see SECURITY_AUDIT.md §3.4).

Please do not include proprietary RTL in reports; a minimal VHDL snippet that reproduces the problem is enough.

The most recent review is in [SECURITY_AUDIT.md](SECURITY_AUDIT.md).
