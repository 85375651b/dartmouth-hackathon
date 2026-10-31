# ClaudePack

ClaudePack turns a top-down packing photo into reviewed, category-ordered footprint
arrangements and step-by-step illustrative 3D layers. Its SVG mark shows an orange star inside a white suitcase outline
on Dartmouth green; assets live in
`public/claudepack-mark.svg` and `src/app/icon.svg`.

## Run locally

Next.js 16 App Router, React 19, TypeScript and Tailwind CSS 4. Node >=20.9.
Use this checkout; no second app, database or account system is required.

```sh
npm install
npm run dev
```

Open <http://localhost:3000>. Reuse the running development server; edits reload.
If local Turbopack cannot start its CSS worker, use
`npm run dev -- --webpack --hostname 127.0.0.1`.

## Configure live services

Create your own ignored `.env.local` using `.env.example` as a guide. Supply:

- `ANTHROPIC_API_KEY`: image-grounded names/category suggestions and structured
  baggage-policy extraction. `CLAUDE_MODEL` defaults to `claude-sonnet-4-6`.
- `AVIATIONSTACK_API_KEY`: flight occurrences through aviationstack's flights API.
  Endpoint availability and schedule coverage depend on the provider plan.
- `TAVILY_API_KEY`: search/read current official airline policy sources.

Restart the dev server after changing server environment variables. Do not put
keys in client code or commit `.env.local`. Missing/unavailable services report
honest setup/errors, never sample flights, fake allowances or invented detections.
The current development environment has no configured provider keys, so live
recognition, schedules and policy extraction have not been verified end to end.
Transport/parser tests use explicit mocked providers.

Photo pixels and geometry are analyzed locally. **Analyze photo** also sends
measured-region image crops through this app's server to Anthropic for suggested
identities/categories; the UI discloses this before analysis. The app does not
persist photographs. Flight lookup sends the entered number to aviationstack;
policy queries/excerpts go through Tavily and Anthropic. Provider terms, costs,
retention and credentials remain the operator's responsibility.

## Current website

- **Photo packing works independently, with no flight number or flight-service setup required.**
  It is the primary workflow. The optional flight lookup is collapsed beneath it.
- **Trip settings** optionally accepts a flight number and lookup. It shows reported
  occurrences, routes, time zones, carrier/codeshare information and sourced,
  conditional numerical baggage rules when available. A recurring flight number
  never identifies a booked date, fare or included allowance. Current official
  source links, evidence and retrieval times remain visible.
- **Pack from a top-down photo** asks for usable interior length/width and one
  photograph. There are no manual corners, pixels, item measurements or second
  profile photo. Improved local segmentation fits an illumination plane to border
  pixels and can retry with median denoising. It still requires clear separated
  items, a visible framed opening and suitable contrast; unsupported scenes reject.
- **Review** shows measured, numbered regions plus Claude's identity/category
  suggestions when configured. Names/categories can be corrected and must be
  confirmed. The category example list is internal, not a visible guide. Regions
  are associated with recognition by explicit stable IDs and image crops.
- **Layers** use conservative 2D footprints, rigid → semi-rigid → puffy, sharing
  partial layers. One illustrative CSS-3D layer is shown at a time; previous/next,
  keyboard and touch-swipe controls are separate from explicit layer completion.
  A 2D/text fallback is available. Decorative visual lift is not measured geometry.
  Check **My suitcase cannot fit another layer** to pause and list all items not
  in completed layers; uncheck to resume. Photo/category/geometry changes reset
  incompatible progress. No volumes, physical heights or closure are inferred.
- **Apply** explicitly saves a proposal. Optional stable inventory links move only
  linked placed entries. Photo-only detections do not invent inventory measurements.
- **Optional inventory** retains existing real weight/handling metadata and legacy
  fields. Existing room-domain helpers and T06 compression/optimizer contracts are
  kept for compatibility/tests, but room-storage and demo interfaces are removed.

Fresh sessions contain no sample trip, inventory, dates, weights, allowances or
room zones. One unmeasured suitcase slot represents the bag to be photographed;
kind, exterior dimensions, empty weight and limits are unknown. State and physical
packing progress live in browser memory only; refresh starts an empty session.

The photo's interior footprint is only a lower bound for exterior dimensions.
Conditional warnings use sufficient known dimensions/weights only. They never
infer weight from appearance, sum an unknown dimension, or issue airline clearance.
See [geometry, recognition and layer limitations](docs/photo-area-packing.md).

## Verification

```sh
npm run check
node --experimental-strip-types --test scripts/*.test.ts
```

`check` runs TypeScript, legacy fixture integrity (`validate:data`) and production
build. Bundled `createDemoData` is a test fixture only, not runtime initialization.
Empty initialization and new contracts have separate regression tests. No linter
is configured. The established local production-build fallback is:

```sh
NEXT_TELEMETRY_DISABLED=1 npm run build -- --webpack
```

Shared types remain in `src/lib/types.ts`, state in `src/state/packwise-store.tsx`.
Internal `PackWise…` identifiers remain compatibility names; the product is
ClaudePack. Work locally. Do not commit/push/publish without explicit permission;
pull latest target-branch changes before every authorized push.

## Agent setup

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

`next dev` adds a Next.js agent-rules block to `AGENTS.md`. To stop that, set
`agentRules: false` in `next.config.ts`.

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
tree should be clean. This checks the Git workflow; run `npm run check` for the
application checks.

Before starting application work, check the event's official rules for build
timing, pre-existing materials, and AI assistance.
