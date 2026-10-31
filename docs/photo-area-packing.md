# ClaudePack photo packing

## One photo, reviewed suggestions, one layer at a time

No flight number is required. Photo analysis, item review, layer generation,
physical packing progress and Apply work independently of flight lookup. Optional
flight/baggage lookup is collapsed below the photo workflow. Only baggage cross-
checks depend on flight results. Automatic item recognition still needs its own
Anthropic key; flight-provider credentials are not needed for photo packing.

Enter usable interior length/width in cm or inches and upload a top-down image
of the empty suitcase with separated, already-prepared items beside it. Exclude
wheels, lining, handles, curves and dividers from the usable base. No user marks
corners, enters pixels or measures individual items. The reference and items
should be as close as practical to one flat plane. Avoid overlap and strong shadows.

**Analyze photo** reads pixels locally, then submits a crop of each measured region
to the Claude Messages API through `/api/recognize`. Names/category suggestions
are image-grounded, not inferred by the classical detector. Each crop and response
carries its exact stable detection ID; response order never determines association.
Review numbered outlines, identities, suggested malleability and uncertainty.
Correct suggestions, ignore false positives and confirm the full detection overlay.
If an item is missing, merged, cropped or incorrectly outlined, retake the photo.
Model-flagged geometry problems block proposal generation. Late suggestions cannot
overwrite a manually edited or confirmed review. Missing credentials allow honest
manual identity/category review, without pretending recognition succeeded.

Internal examples guide rigid (1), semi-rigid/foldable (2) and puffy (3) suggestions.
They are not exposed as a searchable guide. Category controls ordering only; it
never shrinks footprints, assumes materials or invents a compression factor.

## Pixel detector and improvement

The dedicated worker decodes an EXIF-oriented image downsampled to a maximum
1,000-pixel long side (at most one million pixels). File limits are 20 MB/40 MP.
Transparent cutouts are rejected. It uses:

1. Robust, per-channel linear illumination planes fitted to border samples.
   Outlier rejection distinguishes a mild lighting gradient from clutter. Unlike
   the old single median background color, a gradual brightness change need not
   split the floor into invented foreground regions.
2. Four-connected background/foreground and near-color components. Large uniform
   regions with a contrasting enclosing frame, correct aspect ratio and suitable
   quadrilateral fit become candidate suitcase openings. Multiple credible openings
   and cropped objects reject. This identifies geometry, not suitcase semantics.
3. Raw detection first; a bounded 3×3 median-denoising retry can suppress isolated
   liner/sensor noise when raw detection fails. Retry results are labeled denoised;
   this can move boundaries or suppress very small details, so careful review is
   mandatory. It is not a general segmentation model or a solution for touching
   objects, seams, arbitrary backgrounds, dark rims or occluded interiors.
4. A convex outline and minimum-area oriented bounding rectangle for each detected
   item. Internal holes/gaps are not assumed usable nesting space. Very small
   regions below max(30 pixels, 0.08% image area) are noise candidates and can be
   missed. Compact merged objects may pass geometric checks; review is essential.

Pixel outlines, raw counts, original/analysis dimensions, physical outlines and
transform coefficients remain available internally. No geometry is supplied by
Claude. Geometry checks are not calibrated semantic confidence scores.

## Areas and ratios

Canonical lengths are cm, areas cm². 1 inch = 2.54 cm and 1 in² = 6.4516 cm².
For a front-facing reference with physical L/W and detected pixel pL/pW:

```
length scale = L / pL
width scale = W / pW
area scale = (L / pL) × (W / pW)
item area ≈ mask pixels × area scale
item/base = item area / (L × W)
item A/B = corrected area A / corrected area B
```

The detected quadrilateral supplies a planar homography. For mild perspective,
transform each foreground pixel cell and sum its physical area; do not apply one
raw pixel-area ratio globally. Strong perspective, unstable boundaries and remote
points reject. This cannot correct raised items, reference-plane differences,
curved geometry, lens distortion or incorrect user input. Soft/noisy masks are
approximate. Synthetic fixtures verify algorithm behavior, not real-camera accuracy.
Two previously inspected real travel photos with cluttered/cropped borders were
rejected by the old workflow; no broad real-photo acceptance rate is established.

## Proposal, display and physical progress

The deterministic category-ordered best-fit heuristic packs conservative rectangles
into disjoint free regions: rigid → semi-rigid → puffy. It tries all remaining
same-category candidates before opening a new layer, allows a 90° in-plane turn
and continues the next category in available space. It never tips objects to an
unobserved face, reshapes them or treats area sums alone as proof of fit. Oversized
footprints and known handling restrictions have explicit unplaced reasons.

`validateAreaPlan` checks fingerprints, category order, IDs, shapes/rotations,
bounds, overlaps, free-region accounting and known handling restrictions again on
Apply. Existing linked carry-on/fragile/cleanliness facts remain independent of
photo recognition. Unlinked detections have unknown handling. No stacking safety
or global optimality is claimed.

The layer viewer uses real CSS 3D transforms on footprint planes, with a fixed
**decorative** eight-pixel lift. This is not physical item thickness, suitcase
height, a volume estimate or a reconstructed 3D object. No new rendering dependency
or WebGL is required. Rotate-view controls change the illustration only. A 2D
checkbox, automatic unsupported-CSS fallback and persistent text instructions keep
it accessible. Touch swipes and keyboard arrows navigate; they do not mark layers
complete. Next requires explicit completion of the current layer.

**My suitcase cannot fit another layer** pauses prompts and allows review of
completed layers. The current uncompleted layer is not implicitly completed.
Remaining entries are distinguished from geometric failures. Unchecking resumes.
Completion data is session-local, separate from the intended assignment blueprint.
Changing photo/dimensions/reviews/relevant inventory invalidates incompatible
proposals/progress; applying the same arrangement preserves its physical progress.

“These layers show footprint arrangements only. Check the suitcase’s real height
and ability to close as you pack.”

Upload, recognition and proposal do not change inventory or assignments. Explicit
Apply saves the blueprint/interior L/W and moves only explicitly associated placed
inventory IDs. Existing unpictured contents, unrelated bags and room-domain data
are retained. A photo-only detection never creates guessed weight or dimensions.
Worker termination, request tickets and abort controllers guard against old decode,
recognition and flight responses replacing newer input. Clear terminates analysis;
refresh clears the session. Raw photos are not persisted by this app. Anthropic
processing follows the provider's terms; do not describe it as on-device-only.

## Flights and baggage

`/api/flights` normalizes IATA/ICAO flight numbers and queries aviationstack using
`flight_iata` or `flight_icao`. It preserves reported dates, time zones, routes and
codeshares without selecting a booked date. Provider plan/coverage may limit results.
A shared/codeshare or ambiguous carrier does not yield an inferred baggage policy.

For supported carrier IATA codes, Tavily searches an explicit official-domain
allowlist and returns source text. Claude extracts structured limits. Every emitted
number must occur in a contiguous exact source evidence excerpt with its source
units. Units convert to cm/kg; invented numbers, unsupported units and off-domain
URLs reject. All rules remain **conditional**: a flight number cannot establish
fare, cabin, benefits, purchased baggage or date-specific entitlement. Source links,
evidence and retrieval time are exposed. No fees are guessed. Unsupported carriers,
missing keys, unreadable pages, provider errors/rate limits and extraction failures
produce unknown/error states, never demo data. Excerpts are untrusted data, not
instructions, and raw HTML is not rendered.

Warnings compare only sufficient known lower bounds: e.g. interior axes exceeding
permitted exterior axes in every orientation, or real known weights already above
a conditional weight limit. Unknown empty weight/items remain unknown. No item-area
comparison is treated as a bag-size check, no weight is inferred from pictures and
no missing third dimension is summed. No warning means no verified clearance.

## Configuration and checks

Use the server-only placeholders in `.env.example`: `ANTHROPIC_API_KEY`, optional
`CLAUDE_MODEL`, `AVIATIONSTACK_API_KEY`, `TAVILY_API_KEY`. Restart after configuring.
`/api/status` reports configuration presence only, not authentication validity.
No provider keys are configured in the current environment, so live service
accuracy/end-to-end success is unverified. Mocked transport tests exercise actual
request/response paths without spending API credit or sending real photos.

```
npm run check
node --experimental-strip-types --test scripts/*.test.ts
NEXT_TELEMETRY_DISABLED=1 npm run build -- --webpack
```

The last command is the established fallback for local Turbopack permission errors.
Browser checks cover empty/default state, missing-configuration states, actual pixel
worker/decoding, category review, layer progress, stop/resume, keyboard, 2D fallback,
Apply/staleness and mobile layout. Synthetic test images are never runtime demo data.
Touch handlers are implemented; actual device swipe verification depends on the
available browser-control capabilities and must not be claimed if unavailable.

API references: [Claude vision](https://platform.claude.com/docs/en/build-with-claude/vision),
[Claude Messages](https://platform.claude.com/docs/en/api/http/messages),
[aviationstack](https://aviationstack.com/),
[Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search).

## Multi-surface photo fallback

The border no longer has to fit one lighting plane: dominant-border color modes
can recover scenes with a wall/skirting strip. If that and denoising cannot find
an interior, deterministic color families identify lining regions, including a
connected clamshell pair. Dark-rim support, aspect, taper and ambiguity checks
remain required. One opening is the reference; the adjacent half is excluded,
not counted as an item or as extra reference width. The overlay shows that other
half dashed gray and asks the user to verify which opening their dimensions describe.

Edge-guided closed regions and color-connected bodies supply conservative outline
proposals; overlapping printed/body fragments are grouped. These are labeled
**conservative outline areas**, not exact segmented areas. They may still split,
miss or group transparent, low-contrast or touching objects. The existing explicit
whole-scene review remains mandatory, and model-flagged incomplete regions cannot
be confirmed for packing. A false positive can be ignored without blocking every
other item. No manual corners, pixels, flight number or depth inputs were added.

A crop of the photo visible in the reported screenshot was processed locally and
now reaches review instead of the previous blanket clutter rejection. That private
screenshot/crop remains outside the repository. Test dimensions used for this
reproduction are a sample scale, not verified physical suitcase measurements;
this does not establish measurement accuracy or complete recognition of every item.
Synthetic regression tests cover wall/skirting scenes, paired halves, deterministic
outlines, missing framed interiors and validation guards.
