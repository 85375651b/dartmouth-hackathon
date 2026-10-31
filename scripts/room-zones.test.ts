import assert from "node:assert/strict";
import { test } from "node:test";
import { createDemoData } from "../src/lib/demo-data.ts";
import { newRoomZoneId, roomZoneDraft, saveRoomZone, setRoomZoneConfirmation, removeRoomZone, validateRoomZoneDraft, type RoomZoneDraft } from "../src/lib/room-zones.ts";
import { roomZoneLoads } from "../src/lib/loads.ts";
import { validatePackWiseData } from "../src/lib/validate.ts";

function blankDraft(): RoomZoneDraft { return { ...roomZoneDraft(), name: "Desk drawer", kind: "drawer" }; }

test("unique IDs, unknown measurements and same-name zones are supported", () => {
  const data = createDemoData();
  const first = newRoomZoneId();
  const second = newRoomZoneId();
  assert.notEqual(first, second);
  const saved = saveRoomZone(data, blankDraft(), first, true);
  const again = saveRoomZone(saved, blankDraft(), second, true);
  const zone = again.roomZones.at(-1)!;
  assert.equal(zone.confirmed, false);
  assert.equal(zone.isDemo, false);
  assert.equal(zone.capacityLiters, null);
  assert.equal(zone.dimensionsCm, null);
  assert.equal(again.roomZones.length, data.roomZones.length + 2);
  assert.deepEqual(again.trip.roomZoneIds, again.roomZones.map(z => z.id));
  assert.equal(again.items, data.items);
  assert.equal(again.suitcases, data.suitcases);
  assert.equal(again.trip.flight, data.trip.flight);
  assert.equal(again.packingPlan, data.packingPlan);
  assert.equal(again.unpackingPlan, data.unpackingPlan);
  assert.deepEqual(validatePackWiseData(again).errors, []);
  assert.equal(saveRoomZone(saved, blankDraft(), first, true), saved);
  assert.equal(saveRoomZone(data, blankDraft(), first, false), data);
});

test("draft validation covers required text, type, categories, finite and complete measurements", () => {
  assert.deepEqual(validateRoomZoneDraft(blankDraft()), {});
  assert.ok(validateRoomZoneDraft({ ...blankDraft(), name: "  " }).name);
  // Simulate untyped input at the validation boundary.
  assert.ok(validateRoomZoneDraft({ ...blankDraft(), kind: "invalid" } as unknown as RoomZoneDraft).kind);
  assert.ok(validateRoomZoneDraft({ ...blankDraft(), suitableCategories: ["invalid"] } as unknown as RoomZoneDraft).suitableCategories);
  for (const field of ["capacityLiters", "lengthCm", "widthCm", "heightCm"] as const) {
    for (const value of ["0", "-1", "Infinity", "NaN"]) {
      assert.ok(validateRoomZoneDraft({ ...blankDraft(), [field]: value })[field]);
    }
  }
  assert.ok(validateRoomZoneDraft({ ...blankDraft(), lengthCm: "10" }).widthCm);
  assert.ok(validateRoomZoneDraft({ ...blankDraft(), lengthCm: "10", widthCm: "20" }).heightCm);
  const draft = { ...blankDraft(), capacityLiters: "1.25", lengthCm: "10.5", widthCm: "20.25", heightCm: "30.75" };
  assert.deepEqual(validateRoomZoneDraft(draft), {});
  const saved = saveRoomZone(createDemoData(), draft, newRoomZoneId(), true);
  assert.equal(saved.roomZones.at(-1)?.capacityLiters, 1.25);
  assert.deepEqual(saved.roomZones.at(-1)?.dimensionsCm, { lengthCm: 10.5, widthCm: 20.25, heightCm: 30.75 });
  const data = createDemoData();
  assert.equal(saveRoomZone(data, { ...blankDraft(), name: " " }, newRoomZoneId(), true), data);
});

test("explicit confirmation, withdrawal and name-only edits preserve data and assignments", () => {
  const initial = createDemoData();
  assert.ok(initial.roomZones.every(z => !z.confirmed && z.isDemo));
  const id = initial.roomZones[0].id;
  const confirmed = setRoomZoneConfirmation(initial, id, true);
  assert.equal(confirmed.roomZones[0].confirmed, true);
  const renamed = saveRoomZone(confirmed, { ...roomZoneDraft(confirmed.roomZones[0]), name: "My closet" }, id, false);
  assert.equal(renamed.roomZones[0].id, id);
  assert.equal(renamed.roomZones[0].confirmed, true);
  assert.equal(renamed.roomZones[0].isDemo, true);
  assert.equal(renamed.unpackingPlan, initial.unpackingPlan);
  const withdrawn = setRoomZoneConfirmation(renamed, id, false);
  assert.equal(withdrawn.roomZones[0].confirmed, false);
  assert.equal(withdrawn.unpackingPlan, initial.unpackingPlan);
  assert.equal(setRoomZoneConfirmation(initial, "zone-missing", true), initial);
});

test("substantive edits require reconfirmation while equivalent numbers and category order do not", () => {
  const data = createDemoData();
  const id = data.roomZones[0].id;
  const confirmed = setRoomZoneConfirmation(data, id, true);
  const draft = roomZoneDraft(confirmed.roomZones[0]);
  for (const edit of [ {kind: "shelf" as const}, {capacityLiters: "1"}, {lengthCm: "99"}, {suitableCategories: []}, {lengthCm:"",widthCm:"",heightCm:""} ]) {
    const result = saveRoomZone(confirmed, { ...draft, ...edit }, id, false);
    assert.equal(result.roomZones[0].confirmed, false);
    assert.equal(result.unpackingPlan, data.unpackingPlan);
  }
  const equivalent = saveRoomZone(confirmed, { ...draft, capacityLiters: `${draft.capacityLiters}.0`, suitableCategories: [...draft.suitableCategories].reverse() }, id, false);
  assert.equal(equivalent.roomZones[0].confirmed, true);
  const dimensions = confirmed.roomZones[0].dimensionsCm!;
  confirmed.roomZones[0].dimensionsCm = { heightCm: dimensions.heightCm, widthCm: dimensions.widthCm, lengthCm: dimensions.lengthCm };
  const reordered = saveRoomZone(confirmed, { ...draft, name: "Name only" }, id, false);
  assert.equal(reordered.roomZones[0].confirmed, true);
});

test("removing assigned zones transfers items exactly once and preserves remaining order", () => {
  const data = createDemoData();
  const id = data.roomZones[0].id;
  const affected = data.unpackingPlan.assignments.filter(a => a.roomZoneId === id).map(a => a.itemId);
  const remaining = data.unpackingPlan.assignments.filter(a => a.roomZoneId !== id);
  data.unpackingPlan.unassignedItemIds = [affected[0], affected[0]];
  const removed = removeRoomZone(data, id);
  assert.deepEqual(removed.unpackingPlan.assignments, remaining);
  assert.deepEqual(new Set(removed.unpackingPlan.unassignedItemIds), new Set(affected));
  assert.equal(removed.unpackingPlan.unassignedItemIds.length, affected.length);
  assert.equal(removed.items, data.items);
  assert.equal(removed.packingPlan, data.packingPlan);
  assert.equal(removed.trip.flight, data.trip.flight);
  assert.deepEqual(removed.trip.roomZoneIds, removed.roomZones.map(z => z.id));
  assert.ok(!removed.unpackingPlan.assignments.some(a => a.roomZoneId === id));
  assert.deepEqual(validatePackWiseData(removed).errors, []);
  assert.equal(removeRoomZone(removed, id), removed);
  const fresh = createDemoData();
  assert.ok(fresh.roomZones.every(z => !z.confirmed));
  assert.equal(fresh.roomZones.length, 5);
});

test("empty zones can be removed and every zone can be removed safely", () => {
  const data = createDemoData();
  const id = newRoomZoneId();
  const added = saveRoomZone(data, blankDraft(), id, true);
  const removed = removeRoomZone(added, id);
  assert.deepEqual(removed.roomZones, data.roomZones);
  assert.deepEqual(removed.unpackingPlan, data.unpackingPlan);
  const empty = data.roomZones.reduce((state, zone) => removeRoomZone(state, zone.id), data);
  assert.equal(empty.roomZones.length, 0);
  assert.deepEqual(empty.trip.roomZoneIds, []);
  assert.equal(empty.unpackingPlan.unassignedItemIds.length, data.items.length);
  assert.deepEqual(validatePackWiseData(empty).errors, []);
});

test("unknown capacity, overloads and category preferences are reported honestly", () => {
  const data = createDemoData();
  data.roomZones[0].capacityLiters = null;
  data.roomZones[0].dimensionsCm = null;
  data.roomZones[0].suitableCategories = [];
  let load = roomZoneLoads(data)[0];
  assert.equal(load.overVolume, null);
  assert.equal(load.needsConfirmation, true);
  assert.deepEqual(load.categoryMismatches, []);
  assert.deepEqual(validatePackWiseData(data).errors, []);
  data.roomZones[0].capacityLiters = 0.01;
  data.roomZones[0].suitableCategories = ["documents"];
  load = roomZoneLoads(data)[0];
  assert.equal(load.overVolume, true);
  assert.equal(load.categoryMismatches.length, load.items.length);
  assert.ok(validatePackWiseData(data).warnings.some(w => w.includes("category")));
  assert.ok(validatePackWiseData(data).errors.some(e => e.includes("capacity")));
});
