import assert from "node:assert/strict";
import { test } from "node:test";
import { createDemoData } from "../src/lib/demo-data.ts";
import { suitcaseLoads } from "../src/lib/loads.ts";
import { optimizePacking } from "../src/lib/packing/optimize-packing.ts";
import type { Item, ItemId, PackWiseData, Suitcase, SuitcaseId } from "../src/lib/types.ts";
import { validatePackWiseData } from "../src/lib/validate.ts";

function item(id: ItemId, edits: Partial<Item> = {}): Item {
  return {
    id, name: id, category: "personal", weightKg: 1, volumeLiters: 1,
    dimensionsCm: { lengthCm: 50, widthCm: 20, heightCm: 20 },
    quantity: 1, fragility: "normal", carryOnRequired: false, ...edits,
  };
}

function bag(id: SuitcaseId, edits: Partial<Suitcase> = {}): Suitcase {
  return {
    id, name: id, kind: "checked", emptyWeightKg: 0, maxWeightKg: 10,
    capacityLiters: 10, dimensionsCm: { lengthCm: 100, widthCm: 50, heightCm: 50 },
    ...edits,
  };
}

function fixture(items: Item[], suitcases: Suitcase[]): PackWiseData {
  const data = createDemoData();
  data.items = items;
  data.suitcases = suitcases;
  data.trip.itemIds = items.map((entry) => entry.id);
  data.trip.suitcaseIds = suitcases.map((entry) => entry.id);
  data.trip.roomZoneIds = [];
  data.roomZones = [];
  data.packingPlan.assignments = [];
  data.packingPlan.unassignedItemIds = items.map((entry) => entry.id);
  data.unpackingPlan.assignments = [];
  data.unpackingPlan.unassignedItemIds = [];
  return data;
}

function assertCompleteAndValid(data: PackWiseData, result: ReturnType<typeof optimizePacking>) {
  const ids = [
    ...result.packingPlan.assignments.map((assignment) => assignment.itemId),
    ...result.packingPlan.unassignedItemIds,
  ];
  assert.equal(new Set(ids).size, data.items.length, "each item occurs exactly once");
  assert.deepEqual([...ids].sort(), data.items.map((entry) => entry.id).sort());
  assert.deepEqual(result.unassignedItems.map((entry) => entry.itemId), result.packingPlan.unassignedItemIds);
  assert.deepEqual(validatePackWiseData({ ...data, packingPlan: result.packingPlan }).errors, []);
  for (const load of suitcaseLoads({ ...data, packingPlan: result.packingPlan })) {
    assert.equal(load.overWeight, false);
    assert.equal(load.overVolume, false);
    const orders = result.packingPlan.assignments
      .filter((assignment) => assignment.suitcaseId === load.suitcase.id)
      .map((assignment) => assignment.packOrder).sort((a, b) => a - b);
    assert.deepEqual(orders, orders.map((_, index) => index + 1));
  }
}

function freezeRecursively<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeRecursively);
    Object.freeze(value);
  }
  return value;
}

test("demo optimization preserves plan identity and satisfies shared validation", () => {
  const data = createDemoData();
  const result = optimizePacking(data);
  assert.equal(result.packingPlan.id, data.packingPlan.id);
  assert.equal(result.packingPlan.tripId, data.trip.id);
  assert.notEqual(result.packingPlan, data.packingPlan);
  assert.equal(result.packingPlan.assignments.length, 19);
  assert.deepEqual(result.unassignedItems, []);
  assertCompleteAndValid(data, result);
});

test("required carry-on entries reserve capacity before larger optional entries", () => {
  const required = item("item-z-required", { carryOnRequired: true, weightKg: 2 });
  const optional = item("item-a-optional", { weightKg: 2, volumeLiters: 2 });
  const data = fixture([optional, required], [bag("case-carry", { kind: "carry-on", maxWeightKg: 2 })]);
  const result = optimizePacking(data);
  assert.deepEqual(result.packingPlan.assignments.map((entry) => entry.itemId), [required.id]);
  assert.deepEqual(result.packingPlan.unassignedItemIds, [optional.id]);
  assertCompleteAndValid(data, result);
});

test("entries with fewer feasible bags precede larger flexible entries", () => {
  const constrained = item("item-z-constrained", {
    weightKg: 2, volumeLiters: 0.5,
    dimensionsCm: { lengthCm: 40, widthCm: 10, heightCm: 10 },
  });
  const flexible = item("item-a-flexible", {
    dimensionsCm: { lengthCm: 10, widthCm: 10, heightCm: 10 },
  });
  const data = fixture([flexible, constrained], [
    bag("case-a-wide", { maxWeightKg: 2 }),
    bag("case-b-small", { maxWeightKg: 2, capacityLiters: 8,
      dimensionsCm: { lengthCm: 20, widthCm: 20, heightCm: 20 } }),
  ]);
  const result = optimizePacking(data);
  assert.deepEqual(result.packingPlan.assignments.map(({ itemId, suitcaseId }) => [itemId, suitcaseId]), [
    [constrained.id, "case-a-wide"], [flexible.id, "case-b-small"],
  ]);
  assertCompleteAndValid(data, result);
});

test("empty bag weight and bundled quantity totals are counted once", () => {
  const data = fixture([item("item-bundle", { quantity: 14, weightKg: 2, volumeLiters: 3 })], [
    bag("case-exact", { emptyWeightKg: 3, maxWeightKg: 5, capacityLiters: 3 }),
  ]);
  const result = optimizePacking(data);
  assertCompleteAndValid(data, result);
  assert.equal(result.packingPlan.assignments.length, 1);
  assert.equal(suitcaseLoads({ ...data, packingPlan: result.packingPlan })[0].totalWeightKg, 5);
  data.suitcases[0].maxWeightKg = 4.99;
  const limited = optimizePacking(data);
  assert.deepEqual(limited.packingPlan.unassignedItemIds, ["item-bundle"]);
  assert.deepEqual(limited.unassignedItems[0].suitcaseFailures[0].reasons, ["weight"]);
});

test("decimal boundaries permit floating-point noise but reject real excess", () => {
  const data = fixture([
    item("item-a", { weightKg: 0.1, volumeLiters: 0.1 }),
    item("item-b", { weightKg: 0.2, volumeLiters: 0.2 }),
  ], [bag("case-decimal", { emptyWeightKg: 0.1, maxWeightKg: 0.4, capacityLiters: 0.3 })]);
  const exact = optimizePacking(data);
  assert.equal(exact.packingPlan.assignments.length, 2);
  assertCompleteAndValid(data, exact);
  data.suitcases[0].maxWeightKg = 0.39999;
  data.suitcases[0].capacityLiters = 0.29999;
  const limited = optimizePacking(data);
  assert.equal(limited.packingPlan.assignments.length, 1);
  assert.deepEqual(new Set(limited.unassignedItems[0].suitcaseFailures[0].reasons), new Set(["weight", "volume"]));
  assertCompleteAndValid(data, limited);
});

test("dimension checks support rotation without treating liters as physical fit", () => {
  const data = fixture([item("item-rotated", {
    dimensionsCm: { lengthCm: 10, widthCm: 40, heightCm: 20 },
  })], [bag("case-rotated", {
    dimensionsCm: { lengthCm: 40, widthCm: 20, heightCm: 10 }, capacityLiters: 8,
  })]);
  const result = optimizePacking(data);
  assert.equal(result.packingPlan.assignments.length, 1);
  assertCompleteAndValid(data, result);
  assert.ok(data.items[0].dimensionsCm);
  data.items[0].dimensionsCm.widthCm = 41;
  const tooLong = optimizePacking(data);
  assert.deepEqual(tooLong.unassignedItems[0].suitcaseFailures[0].reasons, ["dimensions"]);
});

test("unassigned results explain each bag's blocking constraints", () => {
  const data = fixture([item("item-required", {
    carryOnRequired: true, weightKg: 2, volumeLiters: 2,
  })], [
    bag("case-checked"),
    bag("case-carry", { kind: "carry-on", emptyWeightKg: 1, maxWeightKg: 2,
      capacityLiters: 1, dimensionsCm: { lengthCm: 20, widthCm: 20, heightCm: 20 } }),
  ]);
  const result = optimizePacking(data);
  assertCompleteAndValid(data, result);
  const explanation = result.unassignedItems[0];
  assert.ok(explanation.message.trim().length > 20);
  assert.match(explanation.message, /reduce|free|use|add/i, "explanation suggests an action");
  const failures = new Map(explanation.suitcaseFailures.map((failure) => [failure.suitcaseId, failure.reasons]));
  assert.deepEqual(failures.get("case-checked"), ["carry-on-required"]);
  assert.deepEqual(new Set(failures.get("case-carry")), new Set(["dimensions", "weight", "volume"]));
});

test("missing carry-ons and missing suitcases leave whole entries unassigned", () => {
  for (const suitcases of [[], [bag("case-checked")]]) {
    const data = fixture([item("item-required", { carryOnRequired: true })], suitcases);
    const result = optimizePacking(data);
    assertCompleteAndValid(data, result);
    assert.deepEqual(result.packingPlan.unassignedItemIds, ["item-required"]);
    assert.match(result.unassignedItems[0].message, /carry.on|suitcase|bag/i);
  }
});

test("checked bags are preferred, carry-on capacity remains available as fallback", () => {
  const data = fixture([item("item-optional")], [bag("case-a-carry", { kind: "carry-on" }), bag("case-z-checked")]);
  assert.equal(optimizePacking(data).packingPlan.assignments[0].suitcaseId, "case-z-checked");
  data.suitcases[1].maxWeightKg = 0.5;
  assert.equal(optimizePacking(data).packingPlan.assignments[0].suitcaseId, "case-a-carry");
});

test("frozen inputs are unchanged and entity/reference permutations produce identical output", () => {
  const data = fixture([
    item("item-z", { volumeLiters: 3 }), item("item-a", { volumeLiters: 3 }),
    item("item-required", { carryOnRequired: true }), item("item-too-heavy", { weightKg: 30 }),
  ], [bag("case-z"), bag("case-a"), bag("case-carry", { kind: "carry-on" })]);
  const before = structuredClone(data);
  freezeRecursively(data);
  const first = optimizePacking(data);
  assert.deepEqual(data, before);
  assert.deepEqual(optimizePacking(data), first);
  const reversed = structuredClone(before);
  reversed.items.reverse();
  reversed.suitcases.reverse();
  reversed.trip.itemIds.reverse();
  reversed.trip.suitcaseIds.reverse();
  assert.deepEqual(optimizePacking(reversed), first);
  assertCompleteAndValid(data, first);
});

test("existing broken assignments can be replaced without touching room data", () => {
  const data = createDemoData();
  data.packingPlan.assignments = data.items.map((entry) => ({
    itemId: entry.id, suitcaseId: "case-missing", packOrder: 1,
  }));
  data.packingPlan.assignments.push({ ...data.packingPlan.assignments[0] });
  const before = structuredClone(data);
  const result = optimizePacking(data);
  assertCompleteAndValid(data, result);
  assert.deepEqual(data, before);
  assert.equal(result.packingPlan.id, data.unpackingPlan.packingPlanId);
});

test("empty inventories and bags with zero available payload are handled", () => {
  const empty = fixture([], []);
  const result = optimizePacking(empty);
  assert.deepEqual(result.packingPlan.assignments, []);
  assert.deepEqual(result.packingPlan.unassignedItemIds, []);
  assert.deepEqual(result.unassignedItems, []);
  const noPayload = fixture([item("item-one")], [bag("case-full", { emptyWeightKg: 10, maxWeightKg: 10 })]);
  assert.deepEqual(optimizePacking(noPayload).packingPlan.unassignedItemIds, ["item-one"]);
});

test("malformed physical values and quantities fail explicitly", () => {
  const invalidItems: Partial<Item>[] = [
    { weightKg: NaN }, { weightKg: Infinity }, { weightKg: -1 }, { weightKg: 0 },
    { volumeLiters: NaN }, { volumeLiters: Infinity }, { volumeLiters: 0 },
    { quantity: 0 }, { quantity: 1.5 },
    { dimensionsCm: { lengthCm: Infinity, widthCm: 20, heightCm: 20 } },
    { dimensionsCm: { lengthCm: 0, widthCm: 20, heightCm: 20 } },
    { volumeLiters: 21 },
  ];
  for (const edits of invalidItems) {
    assert.throws(() => optimizePacking(fixture([item("item-invalid", edits)], [bag("case-valid")])));
  }
  const invalidBags: Partial<Suitcase>[] = [
    { emptyWeightKg: NaN }, { emptyWeightKg: -1 }, { emptyWeightKg: 11 },
    { maxWeightKg: Infinity }, { maxWeightKg: 0 }, { capacityLiters: NaN },
    { capacityLiters: Infinity }, { capacityLiters: 0 },
    { dimensionsCm: { lengthCm: 100, widthCm: -1, heightCm: 50 } },
  ];
  for (const edits of invalidBags) {
    assert.throws(() => optimizePacking(fixture([item("item-valid")], [bag("case-invalid", edits)])));
  }
});

test("ambiguous IDs and mismatched trip membership fail explicitly", () => {
  const mutations: ((data: PackWiseData) => void)[] = [
    (data) => { data.items.push({ ...data.items[0] }); },
    (data) => { data.suitcases.push({ ...data.suitcases[0] }); },
    (data) => { data.trip.itemIds.push(data.trip.itemIds[0]); },
    (data) => { data.trip.suitcaseIds.push(data.trip.suitcaseIds[0]); },
    (data) => { data.trip.itemIds = ["item-missing"]; },
    (data) => { data.trip.suitcaseIds = ["case-missing"]; },
    (data) => { data.trip.itemIds = []; },
    (data) => { data.trip.suitcaseIds = []; },
    (data) => { data.packingPlan.tripId = "trip-other"; },
  ];
  for (const mutate of mutations) {
    const data = fixture([item("item-valid")], [bag("case-valid")]);
    mutate(data);
    assert.throws(() => optimizePacking(data));
  }
});
