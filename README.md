# Dartmouth hackathon

Workspace ready for the Dartmouth hackathon.

Shared repository for **PackWise** — *From packed to placed.* PackWise plans
what goes in each suitcase and where each item lands in the destination room.
This repository also holds the shared setup for Claude Code and the official
OpenAI Codex plugin (see [Agent setup](#agent-setup)).

## PackWise app

Stack: Next.js 16 (App Router, Turbopack), React 19, TypeScript, and Tailwind
CSS 4, in the repository root. Requires Node.js 20.9 or later (verified with
Node 22.16 and npm 10.9). No other runtime, database, or account is needed.

### Setup

```sh
npm install
```

### Development

```sh
npm run dev
```

Open <http://localhost:3000>. Edits reload automatically. If port 3000 is busy,
run `npm run dev -- --port 3001` and open that port instead. Stop with Ctrl+C.

### Verification

```sh
npm run check
```

This runs, in order (each is also available on its own):

| Command | What it checks |
| --- | --- |
| `npm run typecheck` | TypeScript type checking (`tsc --noEmit`) |
| `npm run validate:data` | Demo data: 15–20 items, 2 suitcases, 5 zones, no dangling or duplicate IDs, carry-on rules, weight and volume limits |
| `npm run build` | Production build (`next build`) |

To preview the production build locally: `npm run build && npm start`, then open
<http://localhost:3000>. Run focused trip-settings tests with
`node --experimental-strip-types --test scripts/trip-settings.test.ts`.
There is no linter yet.

### What exists

- **Starter page** (`src/app/page.tsx`): responsive dashboard with the trip
  summary, two suitcases ("Packed"), and five room zones ("Placed"). Items can be
  moved between suitcases; weight and volume meters update immediately.
- **Shared types** (`src/lib/types.ts`): `Trip`, `Item`, `Suitcase`,
  `PackingPlan`, `RoomZone`, `UnpackingPlan`, and the `PackWiseData` aggregate.
- **Units**: kilograms, liters, and centimeters everywhere. Field names carry the
  unit (`weightKg`, `capacityLiters`, `dimensionsCm.lengthCm`). Helpers are in
  `src/lib/units.ts`.
- **Stable IDs**: prefixed strings (`item-…`, `case-…`, `zone-…`, `trip-…`,
  `pack-…`, `unpack-…`) typed as template literals. Plans store only
  `itemId` → `suitcaseId` / `roomZoneId` assignments, so the same item ID links
  its suitcase and its room zone.
- **Demo data** (`src/lib/demo-data.ts`): a fictional spring term in Barcelona
  with 19 items, a checked suitcase, a carry-on, and five room zones. It is
  labeled "Demo data" in the UI, uses `demo` in every ID, and sets
  `trip.isDemo: true`.
- **State** (`src/state/packwise-store.tsx`): React context and reducer, held in
  browser memory only. Reloading the page resets to the demo data.
- **Load and validation logic** (`src/lib/loads.ts`, `src/lib/validate.ts`):
  pure functions usable from the UI and from Node scripts.

### Edit trip settings

Use **Trip settings** to edit destination, trip length, optional departure date,
manual total suitcase weight limits, and approximate empty suitcase weights.
**Save settings** applies valid fields together; **Cancel** discards drafts.
Limits include the empty bag. Inventory, assignments, IDs, existing capacity,
and the legacy purpose field are preserved; purpose and capacity are no longer
form inputs. Lowering a weight limit can display an overload warning without
moving items. Volume meters explicitly use existing stored/demo estimates,
not confirmed capacities or airline allowances, and do not guarantee fit.

**Flight and baggage details** optionally collects one segment's operating
airline, flight number, airports, cabin, fare brand, benefits, and expected
checked-bag count. Choose **I don't have flight details yet** to pack manually.
Unknown values are allowed; missing information is guidance for a future lookup.
Changing expected count does not create or remove suitcases. Connections, return
flights, and codeshares require additional checks outside this version.

`Trip.flight` is optional for compatibility and contains user-entered details,
never confirmed baggage policy. Departure date continues to use
`Trip.departureDate` (blank means unknown). Demo flight details are explicitly
unknown, with one expected checked bag. No search, external requests, airline
allowance inference, or pricing verification is implemented. Never enter booking
references, passport details, or card numbers. Reloading or **Reset demo** restores
all sample settings and clears drafts; there is no persistence.

Not included yet: login, database or persistence, 3D graphics, AI features,
automatic packing, or editing inventory items and room zones in the UI.

### File layout and suggested ownership

Four teammates can work in parallel with few conflicts if each owns one area.
Changes to `src/lib/types.ts` affect everyone, so agree on them first.

| Owner | Area | Files |
| --- | --- | --- |
| Teammate 1 — Data model and state | Types, units, demo data, store, validation | `src/lib/types.ts`, `src/lib/units.ts`, `src/lib/demo-data.ts`, `src/lib/validate.ts`, `src/state/`, `scripts/` |
| Teammate 2 — Packing | Suitcase views and packing logic | `src/components/packing/`, `src/lib/loads.ts` (suitcase functions), future `src/lib/packing/` |
| Teammate 3 — Room and unpacking | Room zone views and unpacking logic | `src/components/room/`, `src/lib/loads.ts` (zone functions), future `src/lib/unpacking/` |
| Teammate 4 — App shell, design, and docs | Layout, page, shared UI, styling, README | `src/app/`, `src/components/PackWiseDashboard.tsx`, `src/components/shared/`, `src/components/trip/`, `README.md` |

Project configuration (`package.json`, `package-lock.json`, `tsconfig.json`,
`next.config.ts`, `postcss.config.mjs`) is shared: tell the team before adding a
dependency or changing settings.

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
