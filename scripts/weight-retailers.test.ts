import assert from "node:assert/strict";
import { test } from "node:test";
import { estimate_weight } from "../src/lib/pipeline/weight-estimator.ts";
import type { PipelineItem } from "../src/lib/pipeline/contracts.ts";
import {
  WEIGHT_SOURCES, createWeightLoader, parseShopifyWeightKg, parseSpecPageWeightKg,
} from "../src/lib/weight-retailers.ts";

// Small fixtures shaped like the live pages; no network access.
const appleProHtml = `<h2>Size and Weight</h2><p>Height: 1.68 cm</p><p>Weight (M4 Pro): 2.14 kg (4.7 pounds)</p>
  <p>Weight (M4 Max): 2.15 kg (4.7 pounds)</p><p>Weight varies by configuration and manufacturing process.</p>`;
const ankerHtml = `<li>Dimensions: 6.18 × 2.12 × 1.93 in</li><li>Weight: 21.0 oz (595 g)</li>`;
const shopify = (grams: number[]) => ({ product: { title: "Fixture", variants: grams.map((g) => ({ grams: g })) } });

test("Shopify weight is the heaviest size in kg; zero-gram variants are ignored", () => {
  assert.equal(parseShopifyWeightKg(shopify([166, 260, 0, 202])), 0.26);
  assert.equal(parseShopifyWeightKg(shopify([0, 0])), null);
  assert.equal(parseShopifyWeightKg({ product: {} }), null);
  assert.equal(parseShopifyWeightKg(shopify([50_000])), null, "implausible values are rejected");
});

test("spec pages yield the heaviest listed weight across units", () => {
  assert.equal(parseSpecPageWeightKg(appleProHtml), 2.15);
  assert.ok(Math.abs(parseSpecPageWeightKg(ankerHtml)! - 0.595) < 0.001);
  assert.equal(parseSpecPageWeightKg("<p>Weight varies by configuration.</p>"), null);
});

function fakeFetch(routes: Record<string, { body: string; type: string; status?: number }>) {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    assert.equal(init?.redirect, "error", "redirects are never followed");
    const route = routes[url];
    if (!route) return new Response("blocked", { status: 403, headers: { "content-type": "text/html" } });
    return new Response(route.body, { status: route.status ?? 200, headers: { "content-type": route.type } });
  }) as typeof fetch;
  return { fetcher, calls };
}

const tee = WEIGHT_SOURCES.find((s) => s.id === "live-weight-wp-crew-tee")!;
const shoes = WEIGHT_SOURCES.find((s) => s.id === "live-weight-allbirds-canvas-runner")!;

test("loader returns live references, splits pair weights, and lists unavailable sources", async () => {
  const { fetcher, calls } = fakeFetch({
    [`${tee.url}.json`]: { body: JSON.stringify(shopify([166, 260])), type: "application/json; charset=utf-8" },
    [`${shoes.url}.json`]: { body: JSON.stringify(shopify([715, 1000])), type: "application/json" },
  });
  const load = createWeightLoader(fetcher);
  const { references, unavailable } = await load();

  assert.deepEqual(references.filter((r) => r.sourceUrl === tee.url).map((r) => [r.id, r.label, r.unitKg]),
    [["live-weight-wp-crew-tee-shirt", "shirt", 0.26], ["live-weight-wp-crew-tee-t-shirt", "t-shirt", 0.26]]);
  const shoe = references.find((r) => r.label === "shoes")!;
  assert.equal(shoe.unitKg, 0.5, "pair weight is divided into one shoe");
  assert.deepEqual(shoe.attributes, { type: "sneakers_running" });
  assert.ok(Number.isFinite(Date.parse(shoe.checkedOn)));
  assert.equal(unavailable.length, WEIGHT_SOURCES.length - 2);
  assert.ok(unavailable.includes("live-weight-macbook-air"));

  // Successes are cached for hours and failures for 30 s, so an immediate reload makes no requests.
  const before = calls.length;
  assert.deepEqual((await load()).unavailable, unavailable);
  assert.equal(calls.length, before);
});

test("wrong content type, HTTP errors and network failures mean unknown, not a stale or invented value", async () => {
  for (const route of [
    { body: JSON.stringify(shopify([260])), type: "text/html" },
    { body: JSON.stringify(shopify([260])), type: "application/json", status: 500 },
    { body: "not json", type: "application/json" },
  ]) {
    const { fetcher } = fakeFetch({ [`${tee.url}.json`]: route });
    const { references } = await createWeightLoader(fetcher)();
    assert.equal(references.length, 0);
  }
  const offline = createWeightLoader((async () => { throw new TypeError("network down"); }) as typeof fetch);
  assert.deepEqual(await offline(), { references: [], unavailable: WEIGHT_SOURCES.map((s) => s.id) });
});

test("live references feed the existing weight estimator; with none, the item stays unknown", async () => {
  const { fetcher } = fakeFetch({ [`${tee.url}.json`]: { body: JSON.stringify(shopify([166, 260])), type: "application/json" } });
  const { references } = await createWeightLoader(fetcher)();
  const shirt = { id: "item-shirt", label: "shirt", count: 3, attributes: {}, flags: [] } as unknown as PipelineItem;
  const weight = estimate_weight(shirt, { weightReferences: references })!;
  assert.equal(weight.source, "catalog_category_max");
  assert.equal(weight.unitKg, 0.26);
  assert.ok(Math.abs(weight.totalKg - 0.78) < 1e-9);
  assert.deepEqual(weight.source_urls, [tee.url]);
  assert.equal(estimate_weight(shirt, { weightReferences: [] }), undefined, "no live data falls through to the placeholder stage");
});
