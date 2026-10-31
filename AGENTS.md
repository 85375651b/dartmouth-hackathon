# Project instructions

This is the shared Dartmouth hackathon repository. Work in this checkout; do not
create a second project folder or scaffold an application until requested.

## Collaboration

- Read the existing files and Git status before editing. Preserve other people's
  changes and keep each task focused on the user's request.
- Do not commit, push, deploy, or publish unless explicitly requested.
- Make changes in this local checkout first. Each GitHub push requires the
  user's explicit manual go-ahead; permission for one push does not authorize
  later pushes. Do not change GitHub state without that authorization.
- Before every authorized push, pull the latest changes from the target remote
  branch, preserve teammates' work when integrating, resolve conflicts, and
  rerun the relevant checks before pushing. Do not discard local work or force
  push to bypass conflicts.
- After each completed change, verify it on the local development server. Reuse
  an existing server when available; otherwise start it using the documented
  command and report the URL. Local development uses live reload, not a Git
  push or public deployment.
- The app is ClaudePack (formerly PackWise): Next.js (App Router), TypeScript, and Tailwind CSS in the
  repository root. Do not create another project folder. Setup, development,
  and verification commands are documented in `README.md`; run `npm run check`
  before handing off changes.
- Shared types live in `src/lib/types.ts`. Use kilograms, liters, and
  centimeters, and connect entities only by their stable string IDs.
- State lives in browser memory (`src/state/packwise-store.tsx`). Do not add
  login, a database, 3D graphics, or AI integration unless requested.
- Report what changed, how it was verified, and any remaining limitations.

## Claude Code and Codex

- Claude Code imports these instructions through `CLAUDE.md`; Codex reads this
  file directly. Keep shared guidance here to avoid conflicting copies.
- Use the official `codex@openai-codex` Claude Code plugin from
  `openai/codex-plugin-cc`, with the existing local `codex` executable and login.
  Do not install a second runtime or copy authentication into the repository.
- Use `/codex:setup` to check readiness and `/codex:review` for read-only review.
  Delegate write tasks only when authorized and coordinate edits in this shared
  checkout. Do not enable an automatic review loop unless requested.
- Respect the existing user configuration and model defaults; do not add
  machine-specific executable paths or credentials to shared settings.

## Secrets

- Never commit credentials, tokens, private keys, `.env` files, or local agent
  session data. Do not read or print credential files to verify authentication;
  use the tools' authentication-status commands.
- Use environment variables or existing user-level authentication. Examples may
  contain placeholders only. Keep `.env.example` safe to share.
- Git exclusions prevent accidental tracking; they are not an access-control
  boundary. Check staged files for secrets before any future commit.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
