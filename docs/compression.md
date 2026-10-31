# Compression estimates for T06

The pure `estimateCompressedVolume(request, references)` function in
`src/lib/compression.ts` implements:

```text
ratio = reference.compressedVolumeLiters / reference.baselineVolumeLiters
object.compressedVolumeLiters = ratio * object.uncompressedVolumeLiters
```

Supply the object's **compressible material**, explicitly `down`, `synthetic`,
`wool`, or `cotton`, from its label or user knowledge. The existing API field
`fillMaterial` means insulation fill for filled objects, and fabric for an
unfilled blanket. A reference's shell/cover does not determine its fill.
Unknown, mixed fill, foam, and inflatable objects are unsupported; request
clarification instead of guessing. The object kinds are `puffer-jacket`,
`pillow`, `sleeping-bag`, and `blanket`. Volume is liters for the entire entry,
all quantities together. No name-based material inference is performed.

Only references with matching fill and finite positive measurements, compressed
volume at most baseline volume, and provenance are eligible. Prefer actual
uncompressed baselines, then the closest baseline volume, then stable reference
ID to break ties. This selects a single listing/variant, not an average or a
universal material constant. No valid listing means `unavailable`.

## Wool and cotton blankets

The blanket algorithm and measurement conversion live in
`src/lib/compression-bedding.ts`, with selection in `src/lib/compression.ts`.
It requires a **pillow or mattress** reference with matching actual fill,
an expanded baseline, and evidence for both volumes. Sleeping-bag proxies are
excluded from blanket estimation. A cotton cover over foam, polyester described
as “PP cotton,” and wool/latex or wool/spring hybrids cannot establish a match.

The sequence is: identify the blanket material from user input, fetch fixed
retailer pages, extract complete same-product measurements, convert to liters,
reject incomplete or wrong-material references, choose the nearest expanded
volume (stable ID breaks ties), and multiply the blanket's whole-entry volume
by `reference.compressedVolumeLiters / reference.baselineVolumeLiters`.

The live pillow candidates are:

- [REDCAMP cotton-filled camping pillow](https://redcamp.com/products/small-camping-pillows-for-sleeping):
  describes soft cotton filling and open dimensions of 20 × 12 × 3 inches,
  but its packed size is only 11 × 6 inches without a diameter or third
  dimension. The parser cannot establish packed volume.
- [Grüezi Bag SleepWool travel pillow](https://www.gz-bag.de/products/kissen-sleepwool-travel-pillow):
  the published listing provides a wool fill, 2 L packed volume, and only
  30 × 30 cm expanded size, without thickness. Direct access returned HTTP 429
  during verification, and the older translated URL redirected to a homepage.

**Live wool/cotton estimates are currently unavailable.** No complete qualified
pair was found. The API returns 503 with an `unavailable` result; this is not
a calibrated blanket packing feature. The algorithm is verified using complete
synthetic test fixtures, explicitly separated from real retailer evidence.
There is no live mattress adapter yet; the shared spec reader supports verified
future mattress adapters. No ratio is derived from a shipping box.

The strict pillow adapters read the exact product's JSON-LD `Product` description.
They require single, explicit `Filling: 100% wool` / `Filling: 100% cotton`,
`Expanded volume:` / `Expanded dimensions:`, and `Compressed volume:` /
`Compressed dimensions:` fields. The current descriptions do not meet this
contract. Future source changes may require a site-specific parser update;
simply adding missing numbers elsewhere on a page will not enable an estimate.
Duplicate fields/products are rejected so variants are not combined.

Measurement conversion accepts explicit liters, three dimensions in cm or
inches (`L * W * H / 1000` after conversion to cm), or a cylinder with an
explicit diameter (`π * (diameter / 2)^2 * length / 1000`). Two dimensions
never imply a thickness or cylinder. Original measurement text is retained
in `measurementEvidence`; `productKind` distinguishes pillows and mattresses.
Rectangular dimensions are bounding-volume estimates for a soft object.

Example with **test data only**: a verified 20 L cotton pillow packed to 5 L
has ratio `0.25`; applied to a 40 L cotton blanket it yields `10 L`.
This illustrates the requested arithmetic, not an observed retailer ratio.
Factory vacuum compression and blanket packing may use different pressures;
even material-matched cross-product ratios require calibration.

Blanket request:

```json
{
  "itemId": "item-example-blanket",
  "objectKind": "blanket",
  "fillMaterial": "cotton",
  "uncompressedVolumeLiters": 40
}
```

## Local API

`POST /api/compression` with JSON:

```json
{
  "itemId": "item-example-pillow",
  "objectKind": "pillow",
  "fillMaterial": "down",
  "uncompressedVolumeLiters": 20
}
```

Returns `{ result, references }`. An estimate contains `itemId`, `referenceId`,
`ratio`, `compressedVolumeLiters`, and warnings. Resolve `referenceId` against
the response's references for the exact listing, variant, URL, retrieval time,
baseline kind, and both measured volumes. Invalid requests return 400, oversized
bodies return 413, and unavailable source data returns 503 with an explicit
`unavailable` result. The endpoint does not verify inventory membership; T06
must resolve the stable item ID before applying anything.

The server scrapes a fixed initial source set:

- [Adventure Base: Sea to Summit Trek Down](https://www.adventurebase.com.au/sea-to-summit-trek-down-sleeping-bag),
  paired volumes for each temperature/length variant.
- [Kodiak Outfitters: ALPS Gemini 0 Double](https://kodiakoutfitters.com/products/alps-mountaineering-gemini-0-double-sleeping-bag),
  explicit synthetic insulation and a single pair of volume fields.

These are product-specific HTML adapters, not a general web search engine.
REI blocked direct requests during development and is not used as a fallback.
Values are parsed live, never hardcoded fallback ratios. No API key is needed.
Outbound requests have a 12-second timeout, a 4 MiB decoded response limit,
and no redirects. Callers cannot supply URLs. Successful data is cached in
server memory for six hours; failures for 30 seconds, with concurrent fetches
deduplicated. Expired data is never served after a failed refresh. Cache resets
on server restart. Blocks, timeouts, missing specs, and changed HTML produce
unknown estimates. New retailers require explicit adapters and parser checks.

## Measurement limitation

Both sleeping-bag adapters use **stuff-sack volume as a proxy baseline**.
[Sea to Summit explains](https://support.seatosummit.com/hc/en-us/articles/19361699583252-What-size-compression-sack-do-I-need-for-my-sleeping-bag)
that this is already mildly compressed. It is not the true lofted volume of a
sleeping bag. Every such result includes a warning; the formula is an unvalidated
proxy when applied to a fully lofted object. The small source set, pressure,
construction, fill quality and cross-category transfer limit accuracy. In
particular the Gemini double bag is not representative of every synthetic
pillow or jacket. Matching fill alone does not establish equivalent compression.
Measure real examples before using estimates for automated packing decisions.

For a 20 L down object, the current selection is Trek `-9C|15F L`, using the
20 L / 12.2 L pair: `12.2 / 20 = 0.61`, then `20 * 0.61 = 12.2 L`. The L variant
wins the stable-ID tie with R at the same baseline size. This is an illustrative
retailer proxy, not a measured result for that object or a fit guarantee.

T06 can fetch an estimate and show its source/warnings for user review. This
change does not overwrite `Item.volumeLiters` (already packed volume), alter
dimensions, multiply quantities again, or update suitcase/room loads. Applying
the estimate belongs to the future T06 flow. There is no inventory UI yet.

## Verification

```sh
node --experimental-strip-types --test scripts/compression.test.ts scripts/compression-bedding.test.ts
npm run check
```

Tests use small specification fixtures and mocked fetches; they do not require
retailer availability. Live scraping can be checked through the local endpoint.
