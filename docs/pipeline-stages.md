# Weight, trip assignment and liquid-bundle packing

Follow-up: [identity/outfit review and Claude configuration](identity-review.md)
now provide a browser review page, reviewed-instance pipeline input and explicit
prototype placeholders. The strict-estimate defaults described below remain
available with `usePlaceholders: false`.

This implementation supersedes the missing-stage findings in the earlier integration review. One visible calibration suitcase is now an accepted requirement. Existing shared types and Anna's detector, compression and layer algorithms remain unchanged. No GUI or API endpoint was added.

## Entry points

- `src/lib/packing/liquids.py`: pure Python `pack_liquids(...)`, `BundleResult`, `calibrate_slack(samples)`. Standard library only; no file/network I/O, shoe logic, or UI.
- `src/lib/pipeline/weight-estimator.ts`: `estimate_weight(item, userInputs)`.
- `src/lib/pipeline/plan-trip.ts`: `plan_trip(units, items, bags, banned?)`, returning assignments and per-bag unassigned reasons.
- `src/lib/pipeline/container-capacity.ts`: `estimate_container_capacity`, dimensions-stage adapter and capacity-aware tagging.
- `src/lib/pipeline/run-pipeline.ts`: uses these stages by default. Its stage functions remain injectable.
- `src/lib/pipeline/liquids-adapter.ts`: server-side JSON-over-pipes adapter to Python; **python3 is required**, without additional Python packages. Child process has a two-second deadline. This adapter performs transport separately from the pure packer.

Run from the repository root:

```sh
python3 -B scripts/liquids_test.py
node --experimental-strip-types --test scripts/pipeline-stages.test.ts scripts/pipeline-integration.test.ts
node --experimental-strip-types scripts/pipeline-demo.ts
npm run check
```

## Liquid packer contract and assumptions

`pack_liquids(members, slack=1.15, max_dims=None, restarts=300, seed=0)` expands quantities, builds allowed orientations, searches extreme points with volume/z/y/x scoring, and repeats shuffled orders using a local seeded RNG. The first order is height-descending. It checks overlap and optional bounds during each candidate evaluation. Search stops if it reaches the theoretical sum-of-box-volumes lower bound or exhausts its restart/time budget. It never returns a partial arrangement as feasible.

The result retains the requested distinction:

```text
bbox_cm       = the actual arrangement envelope
volume_cm3    = max(product(bbox_cm), lower_bound_cm3) * slack
lower_bound   = sum of box volumes or circular cylinder volumes
flexible      = true
```

Every placement identifies an original axis permutation, original item ID and zero-based instance ordinal. Bounding boxes, not true cylinders, are packed; hexagonal nesting gains are deliberately ignored. The pipeline passes stable instance IDs as packer member IDs so unequal measured containers retain their own geometry. The original source-item ID remains reachable through each instance.

Explicit **ASSUMPTIONS**, also recorded in source comments:

1. `DEFAULT_SLACK = 1.15` is uncalibrated. It reserves **volume**, not 15% on each dimension. `calibrate_slack` returns the raw median measured/estimated ratio from at least five positive samples. If that median is below one, it is returned, but the conservative packer rejects slack below one.
2. `height_axis` overrides “tallest side.” An explicitly identified short/wide bottle must not be stood on a side. `upright_only` always preserves that axis vertically.
3. For a circular cylinder with noisy unequal transverse dimensions, radius uses half the smaller transverse dimension for the lower bound. The full measured rectangular envelope is still packed. A warning records this assumption. This is an estimated lower bound under the supplied geometry model, not a measurement of actual material volume.
4. `restarts` is the **total** number of orders, including the deterministic first order. At least one is required.
5. `max_dims` accepts any axis order as requested. Upright remains z in the selected frame. The caller must not interpret this as permission to tip a physically fixed upright bag. The pipeline leaves `max_dims` unset for bundle estimation and checks the actual suitcase's upright frame in `plan_trip`.
6. `feasible=False` means no full arrangement was **found** under `max_dims`, not proven impossibility. Failure returns zero bbox/volume and an empty arrangement, retaining the lower bound and warning; callers must gate use on `feasible`. The volume ≥ lower-bound invariant applies to successful results.
7. A singleton retains its original bounding box when that orientation is allowed. An explicit upright axis can require rotating it. Slack still multiplies the singleton volume.
8. Same seed gives identical **completed** searches. A hard wall-clock cutoff can interrupt different restarts on different machines; the returned warning states that reproducibility limitation. Strict identical output across such interruptions and a hard 0.5-second wall-clock budget cannot both be guaranteed by this variable-length search.
9. Unknown shape in the pipeline defaults to the measured **box**, not an inferred cylinder. Optional `ItemInput.liquidShape`, `heightAxis`, and `uprightOnly` belong to the dimensions/handling inputs, not new identification-agent attributes.

Shoe pairing stays separate. The geometry adapter now returns `L × 2W × H` for equal shoes, or max length × summed widths × max height for unequal observed boxes. Liquid packing units carry `flexible: true`, `liquidPacking` provenance/arrangement, and the slack-adjusted liters. Bundles themselves still have no mass. The new planner permits reserved volume to exceed the raw envelope volume; the old shared optimizer rejected that combination. Layering uses the actual envelope and retains the existing conservative height gate; it does not yet reshape conformable bundles.

## Weight estimator

This is a real deterministic estimator, not a placeholder or AI call. It applies:

1. Explicit user unit weight, when provided.
2. Existing explicit fallback ceiling override, when provided.
3. Maximum reference weight for matching label, known attributes and empty/full state.
4. If attributes are unknown/unrepresented, maximum reference weight for that **label category** and state.
5. No matching category/state: unavailable; the orchestrator returns a missing-input issue.

`totalKg = final source count × unitKg`, including count margins and after the existing shoe correction. A shoe reference must describe one shoe; drinking vessels are empty, liquid products full. Empty and full reference states cannot substitute for each other. Bundles never enter the weight estimator. Results retain source IDs/URLs and a review flag. The permitted identification attributes are unchanged.

**ASSUMPTION:** “heaviest in the category” means maximum of the supplied reference catalog, not a proven maximum across all real-world products. There is no finite reliable universal bound for arbitrary labels such as “bag.” The bundled catalog is intentionally small; extend `userInputs.weightReferences` with verified dated examples. It does not silently manufacture masses for shirts, books, liquid products, or unsupported categories. No live weight scraper is claimed.

Initial source examples, checked 2026-10-31:

| Reference class | Unit mass | Source |
| --- | --- | --- |
| Thin/light laptop | 1.24 kg | [Apple M4 Air specifications](https://support.apple.com/en-au/122209) |
| Workstation laptop | 2.15 kg | [Apple M4 Max Pro specifications](https://support.apple.com/en-ie/121554) |
| Power bank | .595 kg | [Anker A1695 specifications](https://www.anker.com/products/a1695-anker-power-bank-25000mah-165w) |
| Empty steel water bottle | .97 lb converted to kg | [Hydro Flask 32 oz specifications](https://www.hydroflask.com/32-oz-wide-mouth?color=Oat) |
| Down puffer | .369 kg | [Patagonia Down Sweater specifications](https://www.patagonia.com/product/mens-down-sweater-insulated-jacket/84675.html) |

These models are catalog evidence only, not claims about what model appeared in a photograph. Small catalog maxima can underestimate a heavier unseen product; measurements or a calibrated, representative reference set are still needed before treating estimates as reliable allowances.

## Trip assignment

`plan_trip` is a deterministic first-fit-decreasing planner with native allowed-bag IDs, prohibited/review states, must-have priority, soft cabin preference, upright-only constraints, kg limits including empty bag, and reserved volume limits. It sorts must-have before optional, then constrained before flexible, then volume/weight/stable ID. Cabin preference chooses among feasible bags and cannot override hard eligibility. Source item weights are looked up by instance ID; repeated ownership is rejected.

It returns per-bag reasons for units that remain unassigned. The orchestrator still runs Anna's layer solver after assignment, excludes failed unit/bag edges and retries. Top preferences remain recorded but are not guaranteed by the unchanged category-based layer solver. Wear/leave actions still require user decisions. This greedy method does not prove infeasibility or global optimality.

## Depth and container capacities

A pixels-to-inches ratio scales a **visible measured length**. It does not reveal an occluded dimension in a top-down image. Current code therefore still requires a prepared height or all three dimensions; it does not quietly treat pixel width as depth.

Practical options for the dimensions owner:

- Add a side/profile photo with a visible reference; pair it to the same instance IDs.
- Use a calibrated depth sensor or multi-view reconstruction, retaining uncertainty.
- For a confirmed circular cylinder lying side-on, use observed diameter for the hidden diameter under an explicit shape/pose assumption. This does not generalize to books, folded clothes or arbitrary bottles.

The capacity adapter uses known 3D dimensions to estimate outer box/cylinder volume in liters, tagged `source: dimensions_estimate`. It can consume direct `userInputs.containerCapacities` from a future dimensions algorithm, or compute from supplied prepared dimensions / matched footprint plus supplied height. It never invents missing depth. Existing manually confirmed capacity stays authoritative.

Outer volume is not rated internal liquid capacity: walls, caps, pumps and irregular shapes matter, and the stated photo noise compounds over three dimensions. Dimension-only capacity therefore stays `needs-review`. An explicit `maximumLiters` exceeded by the supplied capacity sets `prohibited`; the item remains in the source list but is excluded from packing bundles and assignments.

**ASSUMPTION pending the capacity question:** “over capacity” refers to a separately supplied maximum. No global maximum was given. The existing ordinary-liquid >100 ml checked-only rule remains; 100 ml is a cabin threshold, not a universal prohibition. [TSA's checklist](https://www.tsa.gov/sites/default/files/tsa-travel-checklist.pdf) describes the carry-on per-container rule. Empty water bottles/flasks are not prohibited merely because their potential capacity exceeds a liquid threshold.

## Proposed identity and clothing-selection methods

Recommended smallest next change: maintain an **instance ledger**, with immutable IDs minted at first confirmation, detection/crop references and per-instance capacity/mass facts. Derive display groups from label+attributes+relevant facts instead of using group hashes as permanent identity.

1. **Review-and-link now:** show numbered detections, let users confirm or split ambiguous regions and edit per-instance facts. Different-capacity shampoo bottles remain distinct even if their permitted AI attributes match. Count-margin instances remain explicitly synthetic and have no crop.
2. **Assisted matching later:** match detections using image geometry/crop similarity plus compatible labels/attributes; offer ambiguous matches for confirmation. Do not match solely by name, count order or pixel coordinates across different photos.
3. **Outfit selection:** let users select specific instance IDs or “one of these shirts” plus “one of these pants.” Resolve a quantity selection deterministically to available observed instances, show the proposed outfit, and record change-of-clothes as a usage flag. Never select the synthetic margin as a real garment. A suggested outfit can use trip/climate/style inputs, but remains user-confirmed.
4. **Group views only:** counts and packing bundles are derived views of those IDs. Attribute edits regroup the view without changing physical identity. Existing source IDs remain an import alias during migration; this proposal does not silently change shared types or the identifier schema now.

## Verification limits

The Python suite uses plain asserts, with 200 random mixed bundles of 2–10 containers, explicit orientation/overlap/accounting checks, seed checks, bounds checks, malformed-dimension errors, calibration checks and forced timeout. A separate ten-container/300-restart timing assertion requires <1 second on the running machine. It is not an all-hardware performance guarantee or evidence of physical packing accuracy.

The TypeScript suites cover source-weight accounting, catalog maxima/fallback, empty/full state, hard-rule enforcement, native flexible-volume planning, upright constraints, prohibited-capacity exclusion, inch/cm conversion, actual Python bridge calls, shoe geometry, layer retries and end-to-end synthetic packing. `npm run check` covers type generation, demo validation and production build. HTTP checks at http://localhost:3000 verify the existing app still runs, not a new packing UI.

Still unverified: real-bundle slack calibration, representative category-wide weight ceilings, accurate hidden depth or rated capacity from a single overhead photo, and conformable-shape handling in Anna's layer algorithm.
