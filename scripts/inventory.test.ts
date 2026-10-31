import assert from "node:assert/strict";
import { test } from "node:test";
import { createDemoData } from "../src/lib/demo-data.ts";
import { validateInventoryMeasurements } from "../src/lib/inventory.ts";
import { formatKg, formatLiters, formatMeasurementNumber, round1 } from "../src/lib/units.ts";
import { roomZoneLoads, suitcaseLoads } from "../src/lib/loads.ts";
import { optimizePacking } from "../src/lib/packing/optimize-packing.ts";

test("optimizer requests confirmed measurements for T05 unknown values", () => {
  for (const field of ["weightKg", "volumeLiters", "dimensionsCm"] as const) {
    const data = createDemoData();
    data.items[0][field] = null;
    assert.throws(() => optimizePacking(data), /needs positive finite weight, volume, and dimensions/);
  }
});

test("finite extreme measurements remain finite and compact when formatted", () => {
  assert.equal(round1(1e308), 1e308);
  assert.equal(formatMeasurementNumber(1e308), "1E308");
  assert.equal(formatKg(1e308), "1.0E308 kg");
  assert.deepEqual(validateInventoryMeasurements([], null, 1e308, 1e308), {});
});

test("overflowing totals are rejected, excluding the item being edited", () => {
  const item = { ...createDemoData().items[0], weightKg: 1e308, volumeLiters: 1e308 };
  const errors = validateInventoryMeasurements([item], null, 1e308, 1e308);
  assert.ok(errors.weight);
  assert.ok(errors.volume);
  assert.deepEqual(validateInventoryMeasurements([item], item.id, 1e308, 1e308), {});
  assert.deepEqual(validateInventoryMeasurements([item], null, null, null), {});
});

test("measurement validation retains sign, missing-value and finite-number rules", () => {
  assert.deepEqual(validateInventoryMeasurements([], null, 0, null), {});
  assert.deepEqual(validateInventoryMeasurements([], null, 0.125, 0.375), {});
  for (const value of [-1, NaN, Infinity]) {
    assert.ok(validateInventoryMeasurements([], null, value, 1).weight);
    assert.ok(validateInventoryMeasurements([], null, 1, value).volume);
  }
  assert.ok(validateInventoryMeasurements([], null, 1, 0).volume);
});

test("positive tiny measurements and unknowns stay distinct from zero", () => {
  for (const value of [1e-7, 1e-12, Number.MIN_VALUE]) {
    assert.notEqual(formatMeasurementNumber(value), "0");
    assert.notEqual(formatKg(value), "0.0 kg");
    assert.notEqual(formatLiters(value), "0.0 L");
  }
  assert.equal(formatMeasurementNumber(0), "0");
  assert.equal(formatMeasurementNumber(0.125), "0.125");
  assert.equal(formatMeasurementNumber(0.1 + 0.2), "0.3");
  assert.equal(formatKg(null), "Weight unknown");
  assert.equal(formatLiters(null), "Volume unknown");
});

test("assigned tiny measurements remain positive in suitcase and room totals", () => {
  const data = createDemoData();
  data.items = data.items.map((item) => ({ ...item, weightKg: 1e-7, volumeLiters: 1e-7 }));
  for (const load of suitcaseLoads(data)) assert.ok(load.contentsWeightKg > 0);
  for (const load of roomZoneLoads(data)) assert.ok(load.usedLiters > 0);
});
