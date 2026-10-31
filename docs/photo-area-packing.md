# Top-down photo area packing

## Use

In **Pack from a top-down photo**, select a suitcase and enter its explicitly
measured usable interior length and width, in cm or inches. Exterior dimensions
are never substituted. Upload a top-down JPEG, PNG or WebP showing the empty
interior and separated items beside it on a plain, contrasting flat background.
Photograph items in the folded/rolled shape they will actually occupy.

**Analyze photo** calculates image geometry automatically. There are no corner,
edge, pixel, reference-surface or item-measurement controls. Review the green
interior outline and each numbered orange object region. Rename items and choose
and confirm category 1 rigid, 2 semi-rigid/foldable or 3 puffy. Geometry does not
supply semantic names or category suggestions; unsupported suggestions and
recognition-confidence percentages are deliberately not fabricated. The searchable
guide is a non-exhaustive comparison list. Ignore false positives explicitly.
If objects are missing, merged, hidden or incorrectly outlined, choose the retake
action. Do not confirm a bad segmentation. A whole bundle must appear as one
complete region if it is associated with one inventory entry of quantity >1.

**Generate 2D layer plan** changes no shared state. Review diagrams, footprint
utilization, free regions, numbered placement directions and unplaced reasons.
**Apply 2D packing plan** saves the area blueprint and confirmed interior L/W.
Only explicitly linked, placed inventory IDs move; no automatic name/list-order
matching, new inventory entries, item dimensions, weights or other measurements
are created. Unmatched regions stay photo-only. Other assigned items, unplaced
entries, room assignments, flight details and trip data remain unchanged.
Unpictured suitcase contents are not represented in the new diagrams.

“These layers show footprint arrangements only. Check the suitcase’s real height
and ability to close as you pack.”

## Actual detector and supported captures

The implementation is custom classical image processing, running in a dedicated
browser worker. It does not use an external model/API, image search, credentials,
new dependencies, or model downloads. Photos remain in this browser tab. State
is memory-only; reload or Reset demo restores demo data and removes all photos,
reviews and blueprints. Clear photo cancels pending analysis and clears its input.

1. `createImageBitmap` honors image EXIF orientation. Images are limited to 20 MB
   and 40 MP and downsampled, preserving aspect, to a longest side of 800 pixels.
   Original and analysis dimensions remain in the result.
2. A median border color estimates a plain background. Inconsistent borders are
   rejected. Four-connected background regions touching the border establish the
   exterior; enclosed holes are filled conservatively, never used as nesting space.
3. Connected near-color regions yield candidate relatively uniform interiors.
   Convex hulls and oriented rectangles produce four automatic corner estimates.
   Region fill, aspect agreement with interior L/W, surrounding contrast, enclosing
   foreground and perspective limits reject unclear or ambiguous openings. A large
   competing opening causes rejection. This recognizes a *geometric framed opening*,
   not suitcase semantics. A tablet or another framed object can look similar;
   the user's overlay confirmation is essential.
4. Other separated foreground components become numbered object regions. Cropped,
   strongly fragmented/concave or excessive regions cause rejection. Tiny regions
   below max(30 pixels, 0.08% image area) are suppressed as noise, so very small
   items can be missed. Touching objects forming a compact silhouette may not be
   separable; identity/complete-scene review remains mandatory. Objects merged with
   suitcase hardware can be missed. No successful geometry check proves semantic
   identity, complete detection or physical accuracy.
5. A detected quadrilateral provides a homography into the interior length/width
   plane. Strong perspective (opposite edges differing by >18%), near-horizon
   points and item/reference scale differences outside supported bounds reject.
   Automatic quad estimates have pixel/discretization and boundary uncertainty.

This is intentionally a **restricted capture detector**, not production-quality
recognition for arbitrary travel photographs. Dark liners blending into their
rims, seams, straps, textured surfaces, shadows and open lids can cause rejection.
A suitable real-photo benchmark has not established acceptance/accuracy rates.
The UI requests a retake rather than offering manual geometric annotation.

## Measurements

Canonical lengths are centimeters and areas cm². One inch is 2.54 cm; one in² is
6.4516 cm². For a front-facing interior with image axes pL/pW and known L/W:

```
length scale = L / pL
width scale  = W / pW
area scale   = (L / pL) × (W / pW)
item area    = item-mask pixel count × area scale
item/base    = item area / (L × W)
item A / B   = corrected area A / corrected area B
```

Equivalently, under a uniform planar scale, item area is approximately
(item pixels / interior pixels) × (L × W). Raw image corners/outlines, pixel
counts, axis ratios, transform coefficients and rectified outlines are retained
for reproducibility. For perspective-varying scale, each foreground pixel cell's
four corners are transformed and its physical area accumulated; the single raw
pixel ratio is not used globally. UI comparisons use these corrected areas.

Each transformed convex outline has a minimum-area oriented enclosing rectangle.
Packing uses that conservative envelope, including gaps/holes, rather than
pretending an irregular item's area alone determines fit. Segmented silhouette
area and bounding-footprint utilization are labeled separately. Internal holes
are conservatively filled during foreground isolation.

A homography cannot fix elevated items, curved surfaces, lens distortion or
reference-plane differences. User-entered L/W and automatic boundaries can be
wrong. Approximate areas are not precise dimensional measurements or 3D fit.

## Layer heuristic and state

A layer is only the full L × W base footprint. The deterministic best-fit pass
processes rigid → semi-rigid → puffy, sorting by descending envelope area and
stable detection ID within category. It tries all remaining same-category items
in the current layer before opening another, allows 90° in-plane rotation and
continues the next category in remaining free space. Free rectangles are split
into disjoint strips after placement. Small-area but overwide envelopes can be
unplaced; area sums alone do not imply fit. There is no optimality guarantee.

Known carry-on restrictions remain enforced for linked inventory. Known dirty
and clean inventory cannot share the proposal without a containment model; none
is inferred from pixels. Earlier-layer fragile entries reserve their footprints
in subsequent layers as a conservative existing-data restriction. This does not
prove support, crush protection or safe stacking. Unassociated photo items have
unknown handling. Neither height, volume, compression nor closure is calculated;
there is no “suitcase full” result or maximum physically available layer count.

`validateAreaPlan` checks source fingerprints, item accounting, category order,
shape/rotation, bounds, overlaps, handling, reserved space and free-area coverage
again before Apply. Photo/dimension changes cancel analysis and discard previews;
review and relevant inventory/assignment changes make previews stale. Monotonic
request tickets and worker termination prevent old decode/worker results replacing
newer input. Reset remounts the component and terminates outstanding work.

New optional shared contracts: `Suitcase.interiorFootprintCm` and
`PackingPlan.areaPlans`. Old depth-specific profile/paired-photo/layer schemas and
controls are removed. An older in-memory confirmed interior can supply just L/W;
other obsolete extra fields are ignored, not interpreted as current reviews/plans.
Unrelated legacy Item.dimensionsCm/volumeLiters, suitcase capacity estimates,
room dimensions and compression/T06 features remain intact and separate.

## Verification

```
node --experimental-strip-types --test scripts/photo-area.test.ts
node --experimental-strip-types --test scripts/*.test.ts
npm run check
```

The established fallback for local Turbopack build permission failures is:
`NEXT_TELEMETRY_DISABLED=1 npm run build -- --webpack`.

Controlled raster fixtures test automatic detection, area ratios, projective
geometry, rejection, rotations, ordering, mixed layers, stale sources, explicit
Apply and preservation. They are synthetic correctness tests, not evidence of
real-camera accuracy. Browser verification also exercises the actual worker and
file decoding path, desktop/mobile layouts, review, Apply and Reset.

Real-photo checks use publicly available images in `/tmp`, never bundled in the
app or shown as successful fixture detections. An empty suitcase on a patterned
rug with cropped surrounding items from [John Lewis](https://www.johnlewis.com/content/fashion/women/how-to-pack-a-suitcase)
was visually inspected and rejected for cluttered borders; no plan was generated.
A second [partly packed suitcase scene](https://daily-cleaners.com/blogs/blog/20220424)
with a leaf, wood texture and overlapping contents was inspected and also rejected
for cluttered borders, without producing a proposal. These checks verify appropriate
refusals, not successful real-photo measurement.
See also [MDN createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap)
for the EXIF decoding behavior and [OpenCV shape analysis](https://docs.opencv.org/3.4.0/d3/dc0/group__imgproc__shape.html)
for background on connected components (OpenCV itself is not a dependency).
