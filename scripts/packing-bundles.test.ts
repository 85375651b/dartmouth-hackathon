import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  assertBundleInvariants, bundlePackingItems, BundleInvariantError, getUnbundledPackingItems, packingItemId,
  type BundleInputItem, type PackingInventory,
} from "../src/lib/packing/bundles.ts";
import { identifyPackingInventoryInImage } from "../src/lib/vision/packing-inventory.ts";
import { identifyObjectsInImage, tagIdentifiedObject } from "../src/lib/vision/identify-objects.ts";
import type { ItemId } from "../src/lib/types.ts";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/packing-bundles-cases.json", import.meta.url), "utf8")) as {
  case: string; description: string; input: BundleInputItem[]; expected: PackingInventory;
}[];
for (const fixture of fixtures) {
  test(`requested bundle case (${fixture.case}): ${fixture.description}`, () => {
    const before = structuredClone(fixture.input);
    const result = bundlePackingItems(fixture.input);
    assert.deepEqual(result, fixture.expected);
    assert.deepEqual(fixture.input, before, "F never mutates earlier-stage output");
    assertBundleInvariants(result);
    const leftovers = getUnbundledPackingItems(result);
    if (fixture.case === "a") assert.deepEqual(leftovers.map((i) => [i.id, i.count, i.flags]), [["item-boot", 1, ["unpaired_shoe"]]]);
    if (fixture.case === "b") assert.equal(leftovers[0].count, 1);
    if (fixture.case === "c") assert.deepEqual(leftovers, []);
    if (fixture.case === "d") assert.equal(leftovers.length, 2);
  });
}

const shoes = (count: number, id?: ItemId): BundleInputItem => ({
  ...(id ? { id } : {}), label: "shoes", count, attributes: { type: "sneakers_running" }, flags: [], placement_tag: "no-matching-rule",
});
const liquid = (name = "shampoo", liters = 0.05): BundleInputItem => tagIdentifiedObject(
  { label: name, count: 1, attributes: {}, flags: [] }, { containerCapacityLiters: liters },
);
function expectInvalid(result: PackingInventory, edit: (copy: PackingInventory) => void) {
  const copy = structuredClone(result);
  edit(copy);
  assert.throws(() => assertBundleInvariants(copy), BundleInvariantError);
}

test("IDs persist across reordering, count/flag changes, and re-bundling", () => {
  const result = bundlePackingItems([shoes(8), liquid()]);
  assert.deepEqual(bundlePackingItems(result.items), result, "the correction flag prevents subtracting twice");
  const reordered = bundlePackingItems([liquid(), shoes(8)]);
  assert.deepEqual(result.items.map((i) => i.id).sort(), reordered.items.map((i) => i.id).sort());
  assert.equal(packingItemId(shoes(4)), packingItemId(shoes(8)));
  assert.notEqual(packingItemId(shoes(4)), packingItemId({ ...shoes(4), attributes: { type: "boots_hiking" } }));
  assert.match(result.items[0].id, /^item-photo-[a-f0-9]{16}$/);
  assert.equal(bundlePackingItems([shoes(4, "item-existing")]).items[0].id, "item-existing");
});

test("pair only within one entry, including separate entries with identical attributes", () => {
  const result = bundlePackingItems([shoes(3, "item-one"), shoes(1, "item-two")]);
  assert.equal(result.bundles.length, 1);
  assert.deepEqual(result.bundles[0].members, [{ item_id: "item-one", qty: 2 }]);
  assert.deepEqual(getUnbundledPackingItems(result).map((i) => [i.id, i.count]), [["item-one", 1], ["item-two", 1]]);
  expectInvalid(result, (copy) => copy.bundles[0].members.push({ item_id: "item-two", qty: 1 }));
});

test("liquids use existing tags/flags only; singleton and unknown-size bundles are kept", () => {
  const [c] = fixtures.filter((f) => f.case === "c");
  assert.deepEqual(bundlePackingItems([liquid("shampoo"), liquid("lotion", 0.1), liquid("sunscreen", 0.08), liquid("hair gel", 0.25)])
    .bundles.map((b) => [b.bundle_id, b.members.length, b.placement_tag]), c.expected.bundles.map((b) => [b.bundle_id, b.members.length, b.placement_tag]));
  const checked = bundlePackingItems([liquid("shampoo", 0.25)]);
  assert.equal(checked.bundles[0].bundle_id, "liquids_checked");
  assert.equal(checked.bundles[0].members.length, 1);
  const unknown = bundlePackingItems([tagIdentifiedObject({ label: "shampoo", count: 1, attributes: {}, flags: [] })]);
  assert.equal(unknown.bundles[0].placement_tag, "either");
  assert.ok(unknown.bundles[0].flags.includes("placement_review_required"));
  expectInvalid(unknown, (copy) => { copy.bundles[0].flags = []; });
  const opaque = bundlePackingItems([{ ...liquid(), label: "opaque product", placement_tag: "checked-only" }]);
  assert.equal(opaque.bundles[0].bundle_id, "liquids_checked", "F uses the earlier liquid flag, never a label classifier");
  assert.deepEqual(bundlePackingItems([{ ...liquid(), flags: [] }]).bundles, [], "F must not re-identify a product without the earlier liquid flag");
});

test("invalid references, duplicated allocations, quantities and shoe slots raise errors", () => {
  const result = bundlePackingItems([shoes(4, "item-shoes")]);
  expectInvalid(result, (copy) => { copy.bundles[0].members[0].item_id = "item-missing"; });
  expectInvalid(result, (copy) => copy.bundles.push(structuredClone(copy.bundles[0])));
  expectInvalid(result, (copy) => { copy.bundles[1].bundle_id = "shoe_pair:item-shoes:01"; });
  expectInvalid(result, (copy) => { copy.bundles[1].bundle_id = "shoe_pair:item-shoes:3"; });
  for (const qty of [0, -1, 1.5, 3, 5, Number.MAX_SAFE_INTEGER]) {
    expectInvalid(result, (copy) => { copy.bundles[0].members[0].qty = qty; });
  }
  expectInvalid(result, (copy) => copy.bundles[0].members.push({ ...copy.bundles[0].members[0] }));
  assert.throws(() => bundlePackingItems([shoes(2), shoes(2)]), /unique stable/);
  assert.throws(() => bundlePackingItems([shoes(1_000_000)]), /at most/);
});

test("placement conflicts, prohibited liquid members and wrong buckets cannot be hidden by a bundle", () => {
  const result = bundlePackingItems(fixtures.find((f) => f.case === "c")!.input);
  expectInvalid(result, (copy) => { copy.items[0].placement_tag = "carry-on-only"; copy.bundles[0].placement_tag = "checked_only"; });
  expectInvalid(result, (copy) => { copy.items[0].placement_tag = "checked-only"; });
  expectInvalid(result, (copy) => { copy.bundles[1].placement_tag = "either"; });
  expectInvalid(result, (copy) => { copy.bundles = []; });
  assert.throws(() => bundlePackingItems([{ ...liquid(), placement_tag: "prohibited" }]), /conflicting or prohibited/);
  const cabinOnly = bundlePackingItems([{ ...liquid(), placement_tag: "carry-on-only" }]);
  assert.equal(cabinOnly.bundles[0].placement_tag, "either", "the requested cabin bucket tag is preserved");
  assert.ok(cabinOnly.bundles[0].flags.includes("carry_on_only_member"));
  expectInvalid(cabinOnly, (copy) => { copy.bundles[0].flags = []; });
});

test("bundles and members carry no mass; packing consumes residuals and never double-counts items", () => {
  const result = bundlePackingItems([shoes(8, "item-shoes"), liquid()]);
  expectInvalid(result, (copy) => { Object.assign(copy.bundles[0], { weightKg: 1 }); });
  expectInvalid(result, (copy) => { Object.assign(copy.bundles[0].members[0], { massKg: 1 }); });
  const packedQty = result.bundles.reduce((n, b) => n + b.members.reduce((s, m) => s + m.qty, 0), 0)
    + getUnbundledPackingItems(result).reduce((n, i) => n + i.count, 0);
  assert.equal(packedQty, result.items.reduce((n, i) => n + i.count, 0));
  const shoe = result.items.find((i) => i.id === "item-shoes")!;
  assert.equal(shoe.count * 0.3, 2.1, "the mass stage reads seven individual shoes, not an additional three pairs");
});

test("the full workflow appends F with one AI call and leaves the earlier stages unchanged", async () => {
  let calls = 0;
  const image = { mimeType: "image/png", bytes: new Uint8Array([1]) };
  const agent = { async identify() { calls++; return [
    { label: "shoes", count: 7, attributes: { type: "sneakers_running" }, flags: [] },
    { label: "power bank", count: 5, attributes: {}, flags: [] },
  ]; } };
  const earlier = await identifyObjectsInImage(image, agent);
  assert.equal(earlier[0].count, 8);
  assert.equal(earlier[1].count, 6);
  calls = 0;
  const result = await identifyPackingInventoryInImage(image, agent);
  assert.equal(calls, 1);
  assert.equal(result.items[0].count, 7);
  assert.equal(result.items[1].count, 6, "non-shoe count correction stays unchanged");
  assert.equal(result.bundles.length, 3);
  assert.ok(result.items[0].flags.includes("unpaired_shoe"));
  assert.equal(getUnbundledPackingItems(result)[0].count, 1);
});
