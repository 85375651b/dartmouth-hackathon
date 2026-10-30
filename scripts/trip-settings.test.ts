import assert from "node:assert/strict";
import { test } from "node:test";
import { createDemoData } from "../src/lib/demo-data.ts";
import { applyTripSettings, createTripSettingsDraft, validateTripSettings } from "../src/lib/trip-settings.ts";
import { suitcaseLoads } from "../src/lib/loads.ts";

test("valid settings save atomically, trim text, and preserve unrelated entities", () => {
  const data = createDemoData();
  const draft = createTripSettingsDraft(data);
  draft.destination = "  London, UK  ";
  draft.durationDays = "45";
  Object.assign(draft.suitcases[0], { maxWeightKg: "24.75", emptyWeightKg: "3.25" });
  const updated = applyTripSettings(data, draft);
  assert.equal(updated.trip.destination, "London, UK");
  assert.equal(updated.trip.purpose, data.trip.purpose);
  assert.equal(updated.trip.durationDays, 45);
  assert.equal(updated.suitcases[0].capacityLiters, data.suitcases[0].capacityLiters);
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
  for (const field of ["destination"] as const) {
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
  for (const field of ["maxWeightKg", "emptyWeightKg"] as const) {
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
  draft.suitcases[0].maxWeightKg = "5.25";
  const updated = applyTripSettings(data, draft);
  const load = suitcaseLoads(updated)[0];
  assert.equal(load.overWeight, true);
  assert.equal(load.overVolume, false);
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


test("purpose and capacity are absent from drafts; optional flight details do not block saving", () => {
  const data = createDemoData();
  const draft = createTripSettingsDraft(data);
  assert.equal("purpose" in draft, false);
  assert.equal("capacityLiters" in draft.suitcases[0], false);
  draft.departureDate = "";
  draft.destination = "Lisbon";
  assert.deepEqual(validateTripSettings(draft), {});
  const saved = applyTripSettings(data, draft);
  assert.equal(saved.trip.destination, "Lisbon");
  assert.equal(saved.trip.departureDate, "");
  assert.equal(saved.trip.flight?.detailsKnown, false);
  assert.equal(saved.trip.purpose, data.trip.purpose);
  assert.equal(saved.suitcases[0].capacityLiters, data.suitcases[0].capacityLiters);
});

test("flight fields save without implying policy verification or modifying bag count", () => {
  const data = createDemoData();
  const draft = createTripSettingsDraft(data);
  Object.assign(draft.flight, { detailsKnown: true, operatingAirline: " Demo Air ", flightNumber: " U2-456 ",
    originAirport: " BOS ", destinationAirport: " BCN ", cabinClass: "Economy", fareBrand: " Light ",
    baggageBenefits: " Example loyalty benefit ", checkedBagCount: "2" });
  draft.departureDate = "2028-02-29";
  const saved = applyTripSettings(data, draft);
  assert.equal(saved.trip.flight?.flightNumber, "U2-456");
  assert.equal(saved.trip.flight?.operatingAirline, "Demo Air");
  assert.equal(saved.trip.flight?.checkedBagCount, 2);
  assert.equal(saved.trip.departureDate, "2028-02-29");
  assert.equal(saved.suitcases.length, data.suitcases.length);
  assert.deepEqual(saved.suitcases.map(bag => bag.capacityLiters), data.suitcases.map(bag => bag.capacityLiters));
  assert.equal(saved.packingPlan, data.packingPlan);
  assert.equal(data.trip.flight?.detailsKnown, false);
  assert.deepEqual(createTripSettingsDraft(createDemoData()), createTripSettingsDraft(data));
});

test("checked bag count and real calendar dates are validated", () => {
  for (const value of ["", " ", "-1", "1.5", "NaN", "Infinity"]) {
    const draft = createTripSettingsDraft(createDemoData());
    draft.flight.checkedBagCount = value;
    assert.ok(validateTripSettings(draft).checkedBagCount);
  }
  for (const value of ["0", "2"]) {
    const draft = createTripSettingsDraft(createDemoData());
    draft.flight.checkedBagCount = value;
    assert.deepEqual(validateTripSettings(draft), {});
  }
  for (const value of ["2027-02-29", "2028-02-30", "2027-13-01", "0000-01-01", "not a date"]) {
    const draft = createTripSettingsDraft(createDemoData());
    draft.departureDate = value;
    assert.ok(validateTripSettings(draft).departureDate);
  }
  for (const value of ["", "2028-02-29", "2027-12-31"]) {
    const draft = createTripSettingsDraft(createDemoData());
    draft.departureDate = value;
    assert.deepEqual(validateTripSettings(draft), {});
  }
});

test("common flight formats and unknown fields are accepted; invalid provided values are rejected", () => {
  const draft = createTripSettingsDraft(createDemoData());
  draft.flight.detailsKnown = true;
  for (const value of ["", "BA 123", "U2-456", "AA1234", "6E 123", "BA123A"]) {
    draft.flight.flightNumber = value;
    assert.deepEqual(validateTripSettings(draft), {});
  }
  draft.flight.flightNumber = "???";
  assert.ok(validateTripSettings(draft).flightNumber);
  draft.flight.flightNumber = "";
  draft.flight.originAirport = "BOS";
  draft.flight.destinationAirport = "bos";
  assert.ok(validateTripSettings(draft).destinationAirport);
});
