import assert from "node:assert/strict";
import { test } from "node:test";
import { beddingReferenceFromSpecs, beddingVolumeLiters } from "../src/lib/compression-bedding.ts";
import { estimateCompressedVolume, isCompressionRequest } from "../src/lib/compression.ts";
import { createRetailerLoader, parseRetailerPage } from "../src/lib/compression-retailers.ts";
import type { CompressionReference, CompressionRequest } from "../src/lib/types.ts";

const spec = {
  id: "compression-cotton-fixture" as const, listingName: "Test cotton pillow",
  variant: "Single", sourceUrl: "https://example.com/pillow", retrievedAt: "2026-10-31T00:00:00Z",
  productKind: "pillow" as const, material: "cotton" as const,
  materialEvidence: "Filling: 100% cotton", expanded: "50 x 40 x 10 cm", compressed: "5 L",
};
const request: CompressionRequest = { itemId: "item-blanket-test", objectKind: "blanket",
  fillMaterial: "cotton", uncompressedVolumeLiters: 40 };
function fixture(material: "cotton" | "wool", description: string): string {
  return `<script type="application/ld+json">${JSON.stringify({ "@type": "Product",
    name: material === "cotton" ? "Small Camping Pillows for Sleeping" : "SleepWool Travel Pillow",
    description })}</script>`;
}

test("blanket requests accept wool/cotton but do not guess unknown fibers", () => {
  assert.equal(isCompressionRequest(request), true);
  assert.equal(isCompressionRequest({ ...request, fillMaterial: "wool" }), true);
  for (const fillMaterial of ["wool blend", "PP cotton", "foam", undefined]) {
    assert.equal(isCompressionRequest({ ...request, fillMaterial }), false);
  }
});

test("converts complete cm/inch volumes and explicitly labeled cylinders to liters", () => {
  assert.equal(beddingVolumeLiters("50 × 40 × 10 cm"), 20);
  assert.equal(beddingVolumeLiters("20 x 12 x 3 inches"), 720 * 2.54 ** 3 / 1000);
  assert.equal(beddingVolumeLiters("2 litres"), 2);
  assert.equal(beddingVolumeLiters("Ø 10 x 20 cm"), Math.PI * 5 ** 2 * 20 / 1000);
});

test("rejects missing thickness, ambiguous shapes, boxes and invalid units", () => {
  for (const measurement of ["30 x 30 cm", "11 x 6 inches", "Shipping box: 30 x 30 x 10 cm",
    "0 L", "-1 L", "Infinity L", "10 x 10 x 10 feet", "NaN L", "5-10 L"]) {
    assert.equal(beddingVolumeLiters(measurement), null, measurement);
  }
});

test("cotton and wool formula multiplies a same-material ratio by total blanket liters", () => {
  for (const material of ["cotton", "wool"] as const) {
    const reference = beddingReferenceFromSpecs({ ...spec, material, materialEvidence: `Fill: 100% ${material}` });
    assert.ok(reference);
    const result = estimateCompressedVolume({ ...request, fillMaterial: material }, [reference]);
    assert.equal(result.status, "estimated");
    if (result.status !== "estimated") return;
    assert.equal(result.ratio, 5 / 20);
    assert.equal(result.compressedVolumeLiters, 10);
    assert.ok(result.warnings.some((warning) => warning.includes("Factory vacuum")));
    assert.equal(reference.measurementEvidence?.compressed, "5 L");
  }
});

test("blankets reject sleeping bags, wrong fill, cover-only matches and incomplete evidence", () => {
  const reference = beddingReferenceFromSpecs(spec)!;
  const invalid: CompressionReference[] = [
    { ...reference, fillMaterial: "wool" },
    { ...reference, productKind: "sleeping-bag" },
    { ...reference, productKind: undefined },
    { ...reference, baselineKind: "stuff-sack-proxy" },
    { ...reference, measurementEvidence: undefined },
    { ...reference, measurementEvidence: { ...reference.measurementEvidence!, material: "Cover: 100% cotton; Fill: foam" } },
  ];
  for (const candidate of invalid) assert.equal(estimateCompressedVolume(request, [candidate]).status, "unavailable");
});

test("rejects blends, PP cotton and cover labels even with complete measurements", () => {
  for (const materialEvidence of ["Cover: 100% cotton", "Fill: 50% cotton, 50% polyester",
    "Fill: 100% PP cotton", "Fill: 100% cotton and latex", "Fill: memory foam"] ) {
    assert.equal(beddingReferenceFromSpecs({ ...spec, materialEvidence }), null);
  }
  assert.equal(beddingReferenceFromSpecs({ ...spec, compressed: "21 L" }), null);
});

test("supports future mattress references and selects closest size deterministically", () => {
  const a = beddingReferenceFromSpecs(spec)!;
  const b = beddingReferenceFromSpecs({ ...spec, id: "compression-mattress-fixture", productKind: "mattress",
    expanded: "100 L", compressed: "30 L" })!;
  const result = estimateCompressedVolume({ ...request, uncompressedVolumeLiters: 90 }, [a, b]);
  assert.equal(result.status === "estimated" && result.referenceId, b.id);
  assert.equal(result.status === "estimated" && result.compressedVolumeLiters, 27);
});

test("strict retailer parser can use complete structured specs for the exact product", () => {
  const page = fixture("cotton", "Filling: 100% cotton; Expanded dimensions: 50 x 40 x 10 cm; Compressed volume: 5 L");
  const references = parseRetailerPage("cotton", page, spec.retrievedAt);
  assert.equal(references.length, 1);
  assert.equal(references[0].baselineVolumeLiters, 20);
  assert.equal(references[0].compressedVolumeLiters, 5);
  assert.equal(references[0].productKind, "pillow");
});

test("observed retailer omissions remain unknown instead of inventing a volume", () => {
  const cotton = fixture("cotton", 'Filled with soft cotton filling. Measures 20"x12"x3" when open and 11"x6" when compacted into the carry bag.');
  const wool = fixture("wool", "Filling: 100% wool; Expanded dimensions: 30 x 30 cm; Compressed volume: 2 L");
  assert.deepEqual(parseRetailerPage("cotton", cotton, spec.retrievedAt), []);
  assert.deepEqual(parseRetailerPage("wool", wool, spec.retrievedAt), []);
  const result = estimateCompressedVolume(request, []);
  assert.equal(result.status, "unavailable");
  assert.ok(result.status === "unavailable" && result.reason.includes("Missing thickness"));
});

test("ambiguous variants, recommendations and incorrect fill do not become references", () => {
  const description = "Filling: 100% cotton; Expanded volume: 20 L; Compressed volume: 5 L";
  for (const html of [
    fixture("cotton", description + "; Expanded volume: 25 L"),
    fixture("cotton", description.replace("Filling: 100% cotton", "Cover: 100% cotton")),
    fixture("cotton", description).replace("Small Camping Pillows for Sleeping", "Unrelated pillow"),
    fixture("cotton", description).repeat(2),
    `<p>${description}</p>`,
  ]) assert.deepEqual(parseRetailerPage("cotton", html, spec.retrievedAt), []);
});

test("wool/cotton loader uses distinct fixed pages and never falls back to sleeping bags", async () => {
  const urls: string[] = [];
  const loader = createRetailerLoader(async (url, options) => {
    urls.push(String(url));
    assert.equal(options?.redirect, "error");
    return new Response("Blocked", { status: 429 });
  });
  assert.deepEqual(await loader("cotton"), []);
  assert.deepEqual(await loader("wool"), []);
  assert.deepEqual(urls, ["https://redcamp.com/products/small-camping-pillows-for-sleeping",
    "https://www.gz-bag.de/products/kissen-sleepwool-travel-pillow"]);
});
