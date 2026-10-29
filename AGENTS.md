# Project instructions

This is the shared Dartmouth hackathon repository. Work in this checkout; do not
create a second project folder or scaffold an application until requested.

## Collaboration

- Read the existing files and Git status before editing. Preserve other people's
  changes and keep each task focused on the user's request.
- Do not commit, push, deploy, or publish unless explicitly requested.
- No application stack or build/test commands have been chosen yet. Do not invent
  them. Once implementation is requested, document the actual commands and run
  checks appropriate to the changes.
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
