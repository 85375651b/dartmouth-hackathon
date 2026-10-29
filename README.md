# Dartmouth hackathon

Shared repository setup for Claude Code and the official OpenAI Codex plugin.
Application implementation has not started.

Run `claude` from the repository root. Project settings enable
`codex@openai-codex` from `openai/codex-plugin-cc`; accept Claude Code's normal
project/plugin trust prompts when appropriate. Existing installations and logins
are reused. Each collaborator uses their own local authentication.

Verify the local setup:

```sh
claude --version
claude auth status
claude plugin list
codex --version
codex login status
```

Inside Claude Code, run `/codex:setup` for the plugin's readiness check.
Use `/codex:review` for read-only review and `/codex:status` and `/codex:result`
to inspect background jobs. If project settings were added during an existing
session, run `/reload-plugins` or restart Claude Code.

Shared instructions live in `AGENTS.md`, imported by `CLAUDE.md`. Secret files
and local agent state are excluded by `.gitignore`. Keep credentials outside
the repository; Git exclusions do not restrict an agent's file access.
No application dependencies or test commands are configured yet.

## Try the editing workflow

Start with a documentation-only task, such as clarifying a setup instruction:

1. Describe the change and its scope to your coding agent.
2. Review the proposed file changes in the editor's diff view.
3. Check that the instructions are accurate and run `git diff --check` for
   tracked changes. New, untracked files need to be reviewed directly.
4. Request a revision or keep the edit. Commit and push only when explicitly
   requested.

After an explicitly requested commit and push, verify the result:

```sh
git fetch origin
git status --short --branch
git rev-parse HEAD origin/main
```

For work pushed to `main`, the two commit hashes should match and the working
tree should be clean. This checks the Git workflow; application checks will be
added when an application stack is chosen.

Before starting application work, check the event's official rules for build
timing, pre-existing materials, and AI assistance.
