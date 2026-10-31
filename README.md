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

If Turbopack crashes while starting a CSS worker on Windows, use
`npm run dev -- --webpack --hostname 127.0.0.1`. For a production build with
the same workaround, run `npm run build -- --webpack`.

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
Run focused optimizer tests with
`node --experimental-strip-types --test scripts/packing-optimizer.test.ts`.
There is no linter yet.

Run inventory regression tests with
`node --experimental-strip-types --test scripts/inventory.test.ts`.

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
- **Compression estimator for T06**: material-matched retailer scraping and
  `POST /api/compression`, including a wool/cotton blanket algorithm (live bedding
  estimates need complete retailer measurements); see [contract and limitations](docs/compression.md).
- **Packing optimizer (T06)** (`src/lib/packing/optimize-packing.ts`): a pure,
  deterministic function; not yet wired to the dashboard or store.

### Top-down photo area packing

**Pack from a top-down photo** combines usable interior length/width, local image
analysis, detected item review, categories and 2D layer diagrams in one section.
Enter cm or inches and upload one overhead photograph. No user-selected corners,
pixels, item measurements, profile photo, depth or volume calculations are used
by this feature. Categorized items continue into partially occupied layers.

Automatic detection is a restricted, browser-only contrast/connected-region
algorithm, not a general object-recognition model. It needs a plain contrasting
background, an empty clearly framed relatively uniform interior, and separated
items. It rejects unclear geometry and requests a retake. Names/categories need
explicit review; no semantic suggestions or calibrated confidence are invented.
Photos never leave the tab. No packages, credentials or services are required.

Review overlays, confirm categories, generate the footprint proposal, then Apply
explicitly. Optional inventory links are chosen by the user; unmatched detections
remain photo-only. Area arrangements cannot establish stacking height or closure.
Existing inventory volume/weight features, room dimensions and the legacy T06
optimizer are preserved and separate. See [method, limits and verification](docs/photo-area-packing.md).

### Packing optimizer

Call `optimizePacking(data)` with the current trip, items, suitcases, and packing
plan (the full `PackWiseData` object is accepted). It returns `packingPlan` and
`unassignedItems`, with one message and per-suitcase rejection reasons for each
unassigned item. It keeps the existing plan and trip IDs and changes no input.
Applying the returned plan to browser state is a separate integration step.

Required carry-on entries are considered first, then entries that fit in fewer
empty bags, then descending volume, descending weight, and ordinal item ID.
Optional entries try checked bags before carry-ons, with suitcase IDs breaking
ties. Each whole entry is assigned once or explicitly left unassigned. Stored
weight and volume already include its quantity; they are not multiplied again.
Assignments respect total weight including the empty bag, stored estimated
capacity, carry-on requirements, and individual dimensional fit with rotation.
Per-bag `packOrder` follows placement order; no T07 stacking rules are applied.

Malformed source IDs, trip membership, physical values, or plan identity throw
an error. Old assignments are ignored so replanning can repair an overloaded or
invalid assignment. The greedy pass may leave an item unassigned even if a
different arrangement would work. Estimated liters and individual dimension
checks do not guarantee simultaneous physical fit. Notes, fragility, categories,
and unverified flight details do not add baggage rules; AI is not used.

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
automatic unpacking.

### Edit room storage (T12)

Use **Add storage zone** under **Edit room storage**, or **Edit zone** on a card.
Enter a name and storage type; capacity in liters and all three interior
dimensions in centimeters are optional user estimates. Blank measurements are
unknown, never zero or unlimited. Category checkboxes are preferences; none
selected means no category preference. **Save zone** applies edits atomically;
**Cancel** discards the draft. Duplicate names and types are supported.

After saving, explicitly check **I confirm this storage area exists and is
available for my items** on its card. New and demo zones start unconfirmed.
Uncheck to withdraw confirmation. Name-only edits preserve confirmation;
changes to type, measurements, or category preferences require reconfirmation.
Confirmation does not prove fit or safety. Existing manual/demo assignments
remain visible with review warnings. There is no automatic unpacking engine.

**Remove zone** first shows the zone and affected assignment count. Confirming
removal deletes zone references and moves affected items into **Unassigned room
items**, without changing inventory or suitcase assignments. **Keep zone**
cancels removal. **Reset demo** clears open drafts/removal prompts and restores
all five unconfirmed sample zones. All state stays in browser memory.

Shared contract: `RoomZone.capacityLiters` and `dimensionsCm` accept `null` for
unknown values. `confirmed` records explicit availability, and `isDemo` retains
sample provenance even after confirmation. Types add `drawer` and `other` while
keeping existing kinds (`closet` displays as Wardrobe / closet). Room load
`overVolume` is `null` when capacity is unknown; consumers must not interpret
that as feasibility. Loads also expose `categoryMismatches` and
`needsConfirmation`. `Trip.roomZoneIds` stays synchronized with saved zones.
Demo-data validation reports five expected availability warnings, not errors.

Run both focused suites:

```sh
node --experimental-strip-types --test scripts/room-zones.test.ts scripts/trip-settings.test.ts
```

Run `npm run check` for the documented full checks. If the local environment
blocks Turbopack's build-time port binding, the verified alternative production
build is `NEXT_TELEMETRY_DISABLED=1 npm run build -- --webpack`.

### Inventory editor (T05)

The dashboard includes a responsive add/edit form and inventory list. Enter a
name, category, optional weight (kg) and volume (L), fragility, cleanliness,
and carry-on requirement. Edit preserves the item's ID, quantity, notes, and
existing dimensions. Delete removes its references from the trip and both plans.
The list shows entry count, known weight, and how many weights are unknown.
Changes are in browser memory and reset on refresh or **Reset demo**.

`src/components/InventoryEditor.tsx` is controlled through `items: Item[]` and
`onChange(items)`. The dashboard connects it to the shared store's `setItems`
action. T06 and T11 can read `usePackWise().data.items` and dispatch
`{ type: "setItems", items: nextItems }` to add or update entries immutably.
Use stable `item-…` IDs, and preserve existing metadata when updating items.
New items are unassigned in both plans; no optimizer or photo recognition is
implemented here. Carry-on edits remove incompatible checked-bag assignments.
The T06 optimizer requires confirmed measurements; unknown weight, volume, or
dimensions produce an actionable validation error before planning.

Shared `Item` measurements now accept `null` for unknown weight, volume, and
dimensions. Do not infer measurements or treat unknown as a confirmed zero.
Weight may be zero; known volume and dimensions must be positive and finite.
Very small and large measurements use scientific notation so positive values
never appear as zero. Saves that would overflow a total weight or volume are
rejected with a field error. Cancel discards the draft and announces cancellation.
Totals sum known measurements only, with an incomplete-total notice in affected
views. Future optimizers must request or confirm missing measurements before
claiming a bag fits or is under its limit. `ItemCategory` adds `other` while
preserving all original categories. Optional `cleanliness` supports `clean`,
`dirty`, and `protected`; legacy demo entries display as clean.

Browser verification (start at <http://localhost:3000>):

1. Delete the demo entries to exercise the empty state. Refresh restores them.
2. Add Laptop, Electronics, 1.5 kg; then Sneakers, Shoes, 0.9 kg. Leave volume
   blank. Confirm two entries and 2.4 kg known weight in both inventory and trip.
3. Edit Laptop to 1.8 kg; confirm 2.7 kg. Delete Sneakers; confirm only Laptop
   remains with 1.8 kg.
4. Submit an empty/whitespace name, negative weight, or zero/negative volume.
   Confirm errors and no new item. Zero weight is allowed.
5. Add an item with blank measurements. Confirm unknown labels and an
   incomplete-total notice, with no invented measurement.
6. Edit an assigned demo item and confirm suitcase/room views update. Delete
   it and confirm it disappears from those views. Check the form stacks above
   the list on a narrow screen.

T05 verification: TypeScript and demo-data validation pass. Browser checks
cover the add/edit/delete sequence, parent summary updates, unknown values,
and invalid input. Production build passes with `--webpack`; the default
Turbopack build crashes starting its CSS worker on this machine. There is no
configured lint command, so no lint result is claimed.

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
