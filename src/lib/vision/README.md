# Object identification for the weight stage and T06

`identifyPackingInventoryInImage(image, agent)` runs the existing image algorithm
unchanged, then appends plain-code step F to return `{ items, bundles }`.
`identifyObjectsInImage(image, agent)` remains the unchanged pre-F helper,
returning a flat `TaggedDetectedObject[]` with these fields:

```json
{
  "label": "laptop",
  "count": 1,
  "attributes": { "type": "gaming_or_workstation" },
  "flags": [],
  "placement_tag": "no-matching-rule"
}
```

This replaces the previous `name` / `quantity` / nested `baggage` response.
The HTTP response is now `{ "items": [...], "bundles": [...] }`. Items retain
those fields and gain stable `id` values. Bundles contain references and quantities
only; they never copy item data or own mass.

## Order of operations

A. The AI identifies primitive objects, raw counts, permitted attributes, and
   uncertainty flags. It never supplies a placement tag or adjusts counts.
B. Plain code validates the response and removes `suitcase` entries, including
   plural/descriptive labels containing that word.
C. Plain code merges identical label/attribute groups and adds **one** to each
   group's raw count **greater than four**: 4 → 4, 5 → 6, 7 → 8. Different
   attribute values, including null versus known values, remain separate.
D. Plain code applies container assumptions and baggage rules, then appends
   `placement_tag` and any placement-review flag.
F. After the existing carry-on/checked tagging step (called E in the bundling
   request), plain code adds IDs and derives shoe-pair and liquid bundles.

Only stage A uses AI. `postprocessObjectCounts` handles B/C and expects raw
responses; never pass its corrected result back into it. `tagIdentifiedObject`
handles D and can be repeated without changing counts.

## Step F: packing bundles

`src/lib/packing/bundles.ts` exports `bundlePackingItems`,
`assertBundleInvariants`, and `getUnbundledPackingItems`. Input to F is the
already-counted, already-tagged list, not raw AI output. The new complete-workflow
wrapper calls the old algorithm once, then F; the AI prompt, raw schema,
attribute extraction, suitcase removal, count correction and placement tagging
are unchanged by bundling.

Items get deterministic `item-photo-…` IDs based on their label/attribute group,
independent of ordering, flags, and count. If a caller supplies an existing
stable `item-…` ID, it is preserved, including when attributes change. Distinct
entries need distinct IDs; duplicate IDs/collisions raise an error. Bundling
never merges separate entries, even when their attributes are identical.

Shoe pairs contain two units from a single `shoes` entry. Bundle IDs are
`shoe_pair:<item_id>:<ordinal>`; ordinal k reserves units 2k−1 and 2k. This makes
the allocation unambiguous despite identical units sharing an item ID.
Attributes never get mixed across pairs. Complete pairs never receive an
`unpaired_shoe` flag.

The shoe wording contains a conflict: "discard it if n > 6" versus explicit
test (b), which keeps a real leftover. This implementation follows test (b): F
removes the synthetic +1 from every shoe entry that received it, then pairs the
remaining observed shoes. For example, 7 observed → 8 after the unchanged
count stage → 7 in F → three pairs and one unbundled shoe. A remaining odd shoe
stays in the source inventory and is marked `unpaired_shoe`; no observed unit
is silently lost. Non-shoe count corrections stay intact.

`shoe_count_correction_removed` records that F already removed the synthetic
increment, preventing a second subtraction when re-bundling the result. The
`unpaired_shoe` flag on an aggregate item means it has one unallocated shoe;
`getUnbundledPackingItems` yields a count-1 packing item for that remainder.

F identifies liquid products **only** from the prior tagging step's
`assumed_full` flag, with `assumed_empty` excluded. It never calls the liquid
classifier, infers capacity, or changes a member's placement tag:

| Earlier item tag | Bundle ID | Bundle placement_tag |
| --- | --- | --- |
| checked-only | liquids_checked | checked_only |
| All other liquid tags | liquids_cabin | either |

Each bucket contains every unit of each matching entry exactly once, including
singletons. Unknown-size/review flags propagate. An unusual cabin-only liquid
member is retained with `carry_on_only_member`; consumers must honor that
member restriction even though the requested cabin-bucket tag is `either`.
Prohibited or incompatible members cause an invariant error, not a cleared
packing unit. Empty water bottles and flasks have no liquid bundle.

All invariants run before returning: valid/unique IDs and references, positive
quantities, total allocation at most source count, distinct shoe-unit slots,
one complete allocation per liquid entry, compatible placement tags, retained
review flags, and no mass or extra fields on bundles/members. `BundleInvariantError`
is thrown for violations; the HTTP route returns 422. A guard rejects photos
requiring over 10,000 individual pair bundles to prevent unbounded output.

The weight stage reads **only `inventory.items`**. The packing stage reads
`inventory.bundles` plus `getUnbundledPackingItems(inventory)`. The latter
subtracts quantities already claimed by bundles, so a source item with seven
shoes contributes three pair units and one residual shoe to packing, while
weight is estimated once from seven primitive shoes. Do not pack or weigh the
full source items again alongside their bundles.

## Attribute contract

The exact whitelist and strict JSON schema are in `object-contract.ts`.

| Labels | Attribute | Values |
| --- | --- | --- |
| laptop | type | ultrabook_thin_light, standard, gaming_or_workstation, tablet_or_2in1 |
| shoes | type | sandals_flipflops, sneakers_running, boots_hiking, dress_shoes |
| jacket, coat | type | down_puffer, synthetic_puffer, shell_rain, fleece, leather, denim, wool_coat, other |
| mug, cup, drinking vessel; drinking bottle, water bottle, flask, thermos | material | ceramic, glass, plastic, steel, other |
| bag, backpack, tote, duffel, pouch | material | nylon_synthetic, canvas, leather, other |

Every other label has `attributes: {}`. Required attributes that cannot be
determined are `null` and have `flags: ["attribute_uncertain"]`. Neither
`standard` nor `other` is an uncertainty default. Unknown down/synthetic fill,
leather/imitation, or other visually ambiguous attributes must not be guessed.

The explicit drinking-vessel exception is: visibly metal but steel/aluminum
indistinguishable → `material: "steel"` with no uncertainty flag. If even the
material class is unknown, use null. This fallback is specified by the user;
plain code does not invent a material from an unknown value.

Canonical aliases normalize footwear to `shoes`, bag synonyms to their bag
label, and portable chargers to `power bank`. They never infer an attribute.
Counts represent individual physical objects, not pairs of shoes.

No brands, product models, sizes, dimensions, screen sizes, thickness, page
counts, capacities, weights, or liquid-content attributes are requested from
the AI. Runtime validation rejects extra keys, non-whitelisted attributes,
nested attribute values, nested contents, and AI placement decisions. Generic
labels without brand/model/size text are also required by the agent prompt.

## Primitive containers and flags

Primitive items have no children, parent/container relationships, or inferred
hidden contents. Packing bundles are a separate derived list of ID references.
`attributes` is the one explicitly requested object-valued
field; its values are only primitive strings or null. Flags are flat strings:

| Flag | Meaning |
| --- | --- |
| attribute_uncertain | A required weight-relevant attribute is null. |
| assumed_empty | The primitive bag, backpack, tote, duffel, pouch, box, case, drinking bottle, flask, or thermos is treated as empty. |
| assumed_full | A separately recognized liquid product is treated as full. |
| placement_review_required | Baggage rules need additional details or review. |

Closed pouches never generate guesses about contents. Separately visible
belongings get their own flat entries. A toiletry bag does not imply shampoo or
any other contents. Drinking bottles/flasks/thermoses are always treated as
empty; this is a workflow assumption, not an observation about their actual
fill level. Mugs/cups have no inferred contents. Shampoo, lotion, sprays and
other separately identified liquid products stay product entries and are
treated as full. No fill level is placed in `attributes`.

Power banks have label `power bank`, attributes `{}`, and no capacity. The
downstream weight stage can apply its fixed ceiling. Spare batteries retain a
separate generic label and are never merged into the power-bank group.

## Placement tags and the 100 mL rule

`placement_tag` retains the existing code-driven values: `carry-on-only`,
`checked-only`, `needs-review`, `prohibited`, or `no-matching-rule`. The original
rules for spare lithium batteries, power banks, vaping devices, restricted
blades/tools, and liquids remain in `src/lib/packing/baggage-tags.ts`.

Unknown liquid container capacity still requires review; the AI does not emit
sizes. After confirming details separately, rerun stage D, for example:

```ts
import { tagIdentifiedObject } from "@/lib/vision/identify-objects";

const result = tagIdentifiedObject(
  { label: "shampoo", count: 6, attributes: {}, flags: [] },
  { containerCapacityLiters: 0.25 },
);
// checked-only, flags ["assumed_full"], still count 6, still attributes {}
```

Confirmed `BaggageDetails` are separate inputs and never leak into the returned
five-field DTO. The threshold is each container's capacity above **0.1 L**,
not remaining contents, count totals, or `Item.volumeLiters` (packed space).
Exactly 0.1 L does not trigger checked-only. Empty drinking bottles do not get
a liquid tag. Medical/infant/duty-free exceptions, uncertain blade/tool types,
conflicting entries, and aerosol contents/aggregate limits retain review paths.
Recognized prohibited aerosols are not labeled safe for checked baggage.

These are the existing TSA/FAA baseline rules reviewed on 2026-10-31, plus
PackWise's conservative handling of unmeasured tools; they are not a complete
itinerary-specific clearance. `no-matching-rule` means no rule in this subset
matched, not that every travel restriction was checked.

## Local API and T06 handoff

Configure server-only `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` using the
environment or an ignored `.env.local` based on `.env.example`. Use a model
available to your Anthropic account that supports images and structured outputs. `CLAUDE_API_KEY` is also accepted as a key alias. No
model default, new dependency, or client-side API key is added.

Start/reuse `npm run dev`, then submit one JPEG, PNG, or WebP. The local raw upload ceiling is 10 MiB; Claude additionally requires base64 image data under 10 MB (approximately 7.5 MB raw):

```sh
curl -F 'image=@/path/to/objects.jpg' http://localhost:3000/api/identify-objects
```

The route returns `{ "items": [...], "bundles": [...] }`. Existing missing-configuration,
upload-validation, refusal, incomplete-response and timeout handling remains.
It returns `Cache-Control: no-store` and does not persist images/results in the app. A configured request transmits the photo to Anthropic's Messages API. The browser review page at `/packing-review` supports uploads, explicit cross-photo identity links and clothing selection. The legacy `createOpenAIObjectAgent` export is a compatibility alias to Claude; it no longer sends requests to OpenAI.

The weight stage consumes `items` with `label`, final `count`, and only the
permitted weight attributes. For later shared inventory import, map `label` to
`Item.name` and `count` to `Item.quantity`, preserve the generated stable IDs,
and retain attributes/placement metadata alongside those IDs. Shared types and
teammates' optimizer are unchanged. The current optimizer does not yet consume
the new DTO/bundles or enforce its checked-only/review/prohibited tags.

T06 still requires confirmed whole-entry weight, volume, and dimensions.
Unknown measurements stay null; they are not invented here. Do not multiply
whole-entry measurements by count a second time.

## Verification and requested examples

```sh
node --experimental-strip-types scripts/identify-objects.test.ts
node --experimental-strip-types scripts/baggage-tags.test.ts
node --experimental-strip-types scripts/object-attributes.test.ts
node --experimental-strip-types scripts/packing-bundles.test.ts
npm run check
```

The three requested cases and complete expected outputs live in
`scripts/fixtures/object-identification-cases.json` and run through the actual
pipeline using mocked AI identification:

- (a) 7 shirts → 8; an identifiable ultrabook and gaming laptop stay separate;
  a closed pouch with unknown material has material null and is assumed empty.
- (b) 5 power banks → 6, empty attributes, carry-on-only.
- (c) steel mug plus indistinguishable steel/aluminum mug → one material-steel
  group with count 2, following the explicit metal fallback.

The four bundling cases have complete literal JSON inputs/expected outputs in
`scripts/fixtures/packing-bundles-cases.json`:

| Case | Expected packing output |
| --- | --- |
| (a) 4 sneakers + 1 boot | Two sneaker pair bundles; one count-1 boot remains, flagged unpaired_shoe. |
| (b) 7 observed shoes | Item count is 7 after undoing the synthetic increment; three pair bundles and one flagged unbundled shoe. |
| (c) 3 small liquid entries + 1 large | liquids_cabin has three members, tag either; liquids_checked has one member, tag checked_only. |
| (d) Water bottle + flask | Both remain assumed-empty items; bundles is empty. |

The tests also exercise all attribute enums, variant counts, uncertainty,
forbidden measurements/nesting, container assumptions, liquid boundaries,
baggage exceptions, API shape, provider errors, stable IDs, bundling, overlap,
quantity limits, placement conflicts, and primitive-only mass. No paid AI requests are made;
these tests do not establish recognition accuracy on real photos. Local server
smoke checks cover the dashboard and invalid-upload responses.

References: [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs),
[Claude image inputs](https://platform.claude.com/docs/en/build-with-claude/vision),
[FAA batteries](https://www.faa.gov/hazmat/packsafe/lithium-batteries),
[FAA vaping devices](https://www.faa.gov/hazmat/packsafe/e-cigarettes-vaping),
[FAA aerosols](https://www.faa.gov/hazmat/packsafe/aerosols),
[TSA liquids](https://www.tsa.gov/travel/security-screening/liquids-rule),
[TSA tools](https://www.tsa.gov/travel/security-screening/whatcanibring/items/tools),
and [TSA knives](https://www.tsa.gov/travel/security-screening/whatcanibring/items/knives).
