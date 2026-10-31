import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateCompressedVolume, isCompressionRequest } from "../src/lib/compression.ts";
import { createRetailerLoader, parseRetailerPage } from "../src/lib/compression-retailers.ts";
import type { CompressionReference, CompressionRequest } from "../src/lib/types.ts";

const input: CompressionRequest = { itemId: "item-test", objectKind: "pillow",
  fillMaterial: "down", uncompressedVolumeLiters: 20 };
const reference: CompressionReference = { id: "compression-a", listingName: "Test bag",
  variant: "Regular", sourceUrl: "https://example.com/bag", retrievedAt: "2026-10-30T12:00:00Z",
  fillMaterial: "down", baselineKind: "uncompressed", baselineVolumeLiters: 20,
  compressedVolumeLiters: 5 };
// Minimal HTML fixtures preserve the field structures observed on the public pages.
const downHtml = `<p>Fill: 80/20 Duck Down</p>
  <h5>COMPRESSION SACK VOLUME/ASTM F1853-11 COMPRESSED VOLUME</h5>
  <p>-1C|30F R: 13L/8.2L<br>-1C|30F L: 13L/8.8L<br>-9C|15F R: 20L/10.6L</p></section>`;
const syntheticHtml = `<table><tr><th>Insulation Type</th><td>Synthetic</td></tr>
  <tr><th>Stuff Sack Volume</th><td>62 liters</td></tr>
  <tr><th>Compressed Volume</th><td>60 liters</td></tr></table>`;
const htmlResponse = (html: string) => new Response(html, { headers: { "content-type": "text/html" } });

test("computes the requested ratio and volume without changing input", () => {
  const before = structuredClone(input);
  const result = estimateCompressedVolume(input, [reference]);
  assert.equal(result.status, "estimated");
  if (result.status !== "estimated") return;
  assert.equal(result.ratio, 0.25);
  assert.equal(result.compressedVolumeLiters, 5);
  assert.equal(result.itemId, input.itemId);
  assert.deepEqual(input, before);
});

test("matches fill, nearest baseline, then stable ID independently of source order", () => {
  const refs: CompressionReference[] = [
    { ...reference, id: "compression-synthetic", fillMaterial: "synthetic" },
    { ...reference, id: "compression-far", baselineVolumeLiters: 80 },
    { ...reference, id: "compression-z" }, reference,
  ];
  for (const list of [refs, [...refs].reverse()]) {
    const result = estimateCompressedVolume(input, list);
    assert.equal(result.status === "estimated" && result.referenceId, "compression-a");
  }
});

test("prefers real uncompressed evidence and warns about proxy/cross-category transfer", () => {
  const proxy = { ...reference, baselineKind: "stuff-sack-proxy" as const };
  const result = estimateCompressedVolume(input, [proxy]);
  assert.equal(result.status, "estimated");
  if (result.status !== "estimated") return;
  assert.ok(result.warnings.some((warning) => warning.includes("not true lofted")));
  assert.ok(result.warnings.some((warning) => warning.includes("jacket or pillow")));
  const actual = { ...reference, id: "compression-real" as const, baselineVolumeLiters: 40 };
  const preferred = estimateCompressedVolume(input, [proxy, actual]);
  assert.equal(preferred.status === "estimated" && preferred.referenceId, actual.id);
});

test("missing material, unsupported kind and invalid volumes cannot be guessed", () => {
  for (const volume of [0, -1, NaN, Infinity, "20", null]) {
    assert.equal(isCompressionRequest({ ...input, uncompressedVolumeLiters: volume }), false);
  }
  assert.equal(isCompressionRequest({ ...input, fillMaterial: "polyester shell" }), false);
  assert.equal(isCompressionRequest({ ...input, objectKind: "foam-pillow" }), false);
  assert.equal(isCompressionRequest({ ...input, itemId: "case-wrong" }), false);
  assert.throws(() => estimateCompressedVolume({ ...input, uncompressedVolumeLiters: 0 }, []));
});

test("invalid or wrong-material references return unknown rather than fabricated ratios", () => {
  for (const patch of [
    { compressedVolumeLiters: 21 }, { compressedVolumeLiters: 0 },
    { baselineVolumeLiters: 0 }, { baselineVolumeLiters: Infinity },
    { compressedVolumeLiters: NaN }, { retrievedAt: "invalid" },
    { fillMaterial: "synthetic" as const },
  ]) assert.equal(estimateCompressedVolume(input, [{ ...reference, ...patch }]).status, "unavailable");
  assert.equal(estimateCompressedVolume(input, []).status, "unavailable");
});

test("parses paired down variants without mixing their volumes or reading shell material", () => {
  const refs = parseRetailerPage("down", downHtml, reference.retrievedAt);
  assert.equal(refs.length, 3);
  assert.equal(refs[0].baselineVolumeLiters, 13);
  assert.equal(refs[0].compressedVolumeLiters, 8.2);
  assert.equal(refs[1].compressedVolumeLiters, 8.8);
  assert.equal(refs[0].baselineKind, "stuff-sack-proxy");
  assert.equal(parseRetailerPage("down", downHtml.replace("80/20 Duck Down", "Polyester"), reference.retrievedAt).length, 0);
  assert.equal(parseRetailerPage("down", "<p>access denied</p>", reference.retrievedAt).length, 0);
});

test("synthetic table needs explicit insulation and two valid volumes", () => {
  const refs = parseRetailerPage("synthetic", syntheticHtml, reference.retrievedAt);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].compressedVolumeLiters / refs[0].baselineVolumeLiters, 60 / 62);
  for (const page of [syntheticHtml.replace("Synthetic", "Down"),
    syntheticHtml.replace("60 liters", "Unavailable"), syntheticHtml.replace("60 liters", "63 liters")]) {
    assert.deepEqual(parseRetailerPage("synthetic", page, reference.retrievedAt), []);
  }
});

test("loader uses fixed URLs, prevents redirects, deduplicates and caches without leaking mutations", async () => {
  let calls = 0;
  const loader = createRetailerLoader(async (url, options) => {
    calls++;
    assert.equal(url, "https://www.adventurebase.com.au/sea-to-summit-trek-down-sleeping-bag");
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal);
    return htmlResponse(downHtml);
  });
  const [a, b] = await Promise.all([loader("down"), loader("down")]);
  a[0].baselineVolumeLiters = 999;
  assert.equal(b[0].baselineVolumeLiters, 13);
  assert.equal((await loader("down"))[0].baselineVolumeLiters, 13);
  assert.equal(calls, 1);
});

test("network errors, blocked pages, invalid content and oversized pages yield no reference", async () => {
  for (const fetcher of [
    async () => { throw new Error("offline"); },
    async () => new Response("blocked", { status: 403 }),
    async () => new Response("{}", { headers: { "content-type": "application/json" } }),
    async () => htmlResponse("<p>Challenge page</p>"),
    async () => htmlResponse("x".repeat(4 * 1024 * 1024 + 1)),
  ]) {
    const loader = createRetailerLoader(fetcher);
    assert.deepEqual(await loader("down"), []);
  }
});

test("expired successes are discarded after refresh failure and failures retry after 30 seconds", async () => {
  const realNow = Date.now;
  let now = realNow();
  let calls = 0;
  const loader = createRetailerLoader(async () => {
    calls++;
    if (calls === 2) throw new Error("source offline");
    return htmlResponse(downHtml);
  });
  try {
    Date.now = () => now;
    assert.equal((await loader("down")).length, 3);
    now += 6 * 60 * 60 * 1000 + 1;
    assert.deepEqual(await loader("down"), []);
    assert.deepEqual(await loader("down"), []);
    assert.equal(calls, 2);
    now += 30_001;
    assert.equal((await loader("down")).length, 3);
    assert.equal(calls, 3);
  } finally { Date.now = realNow; }
});
