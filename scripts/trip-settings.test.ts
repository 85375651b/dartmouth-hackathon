import assert from "node:assert/strict";
import { test } from "node:test";
import { createDemoData } from "../src/lib/demo-data.ts";
import { applyTripSettings, createTripSettingsDraft, validateTripSettings } from "../src/lib/trip-settings.ts";
import { suitcaseLoads } from "../src/lib/loads.ts";

test("valid settings save atomically, trim text, and preserve unrelated entities", () => {
  const data = createDemoData();
  const draft = createTripSettingsDraft(data);
  draft.destination = "  London, UK  ";
  draft.purpose = "  Research  ";
  draft.durationDays = "45";
  Object.assign(draft.suitcases[0], { capacityLiters: "80.25", maxWeightKg: "24.75", emptyWeightKg: "3.25" });
  const updated = applyTripSettings(data, draft);
  assert.equal(updated.trip.destination, "London, UK");
  assert.equal(updated.trip.purpose, "Research");
  assert.equal(updated.trip.durationDays, 45);
  assert.equal(updated.suitcases[0].capacityLiters, 80.25);
  assert.equal(updated.suitcases[0].maxWeightKg, 24.75);
  assert.equal(updated.suitcases[0].emptyWeightKg, 3.25);
  assert.equal(updated.trip.id, data.trip.id);
  assert.equal(updated.trip.departureDate, data.trip.departureDate);
  assert.equal(updated.trip.isDemo, data.trip.isDemo);
  assert.deepEqual(updated.suitcases.map((bag) => [bag.id, bag.kind]), data.suitcases.map((bag) => [bag.id, bag.kind]));
  for (const key of ["items", "packingPlan", "unpackingPlan", "roomZones"] as const) assert.equal(updated[key], data[key]);
  assert.equal(data.trip.destination, "Barcelona, Spain");
});

test("invalid text and duration never partially save", () => {
  const data = createDemoData();
  for (const field of ["destination", "purpose"] as const) {
    const draft = createTripSettingsDraft(data);
    draft[field] = "   ";
    assert.ok(validateTripSettings(draft)[field]);
    assert.equal(applyTripSettings(data, draft), data);
  }
  for (const value of ["", " ", "0", "-1", "1.5", "NaN", "Infinity"]) {
    const draft = createTripSettingsDraft(data);
    draft.durationDays = value;
    assert.ok(validateTripSettings(draft).durationDays);
    assert.equal(applyTripSettings(data, draft), data);
  }
});

test("bag fields reject missing, nonfinite and invalid signs, and enforce empty weight", () => {
  const data = createDemoData();
  for (const field of ["capacityLiters", "maxWeightKg", "emptyWeightKg"] as const) {
    for (const value of ["", " ", "-1", "NaN", "Infinity", ...(field === "emptyWeightKg" ? [] : ["0"])]) {
      const draft = createTripSettingsDraft(data);
      draft.suitcases[0][field] = value;
      assert.ok(validateTripSettings(draft)[`${draft.suitcases[0].id}-${field}`]);
      assert.equal(applyTripSettings(data, draft), data);
    }
  }
  const draft = createTripSettingsDraft(data);
  draft.suitcases[0].emptyWeightKg = "24";
  assert.ok(validateTripSettings(draft)[`${draft.suitcases[0].id}-emptyWeightKg`]);
  draft.suitcases[0].emptyWeightKg = "0";
  assert.deepEqual(validateTripSettings(draft), {});
  draft.suitcases[0].emptyWeightKg = draft.suitcases[0].maxWeightKg;
  assert.deepEqual(validateTripSettings(draft), {});
});

test("valid lower limits warn, without changing assignments, including decimal boundaries", () => {
  const data = createDemoData();
  const draft = createTripSettingsDraft(data);
  draft.suitcases[0].capacityLiters = "1.25";
  draft.suitcases[0].maxWeightKg = "5.25";
  const updated = applyTripSettings(data, draft);
  const load = suitcaseLoads(updated)[0];
  assert.equal(load.overWeight, true);
  assert.equal(load.overVolume, true);
  assert.equal(updated.packingPlan, data.packingPlan);
  const exact = createDemoData();
  exact.items = [{ ...exact.items[0], weightKg: 0.04, volumeLiters: 0.04 }];
  exact.packingPlan.assignments = [{ itemId: exact.items[0].id, suitcaseId: exact.suitcases[0].id, packOrder: 1 }];
  exact.suitcases[0] = { ...exact.suitcases[0], emptyWeightKg: 0, maxWeightKg: 0.03, capacityLiters: 0.03 };
  assert.equal(suitcaseLoads(exact)[0].overWeight, true);
  assert.equal(suitcaseLoads(exact)[0].overVolume, true);
});

test("unknown or duplicate suitcase IDs cannot replace the current bag set", () => {
  const data = createDemoData();
  const draft = createTripSettingsDraft(data);
  draft.suitcases[1] = { ...draft.suitcases[0] };
  assert.equal(applyTripSettings(data, draft), data);
  draft.suitcases[1].id = "case-unknown";
  assert.equal(applyTripSettings(data, draft), data);
});
