import assert from "node:assert/strict";
import { test } from "node:test";
import { tagBaggageRequirements, type BaggageDetails, type BaggageTag } from "../src/lib/packing/baggage-tags.ts";
import { identifyObjectsInImage } from "../src/lib/vision/identify-objects.ts";

function tag(name: string, details: BaggageDetails = {}) {
  return tagBaggageRequirements([{ name, quantity: 1, ...details }])[0].baggage;
}

test("spare lithium batteries, power banks, e-cigarettes and vapes get cabin-only tags", () => {
  for (const name of ["spare lithium-ion battery", "lithium ion spare batteries", "uninstalled lithium metal battery",
    "lithium battery", "spare lithium-ion drill battery", "power bank", "Powerbank", "portable charger", "e-cigarette", "electronic cigarette", "vape pen", "vaping device",
  ]) {
    assert.equal(tag(name).tag, "carry-on-only", name);
    assert.ok(tag(name).reasons.length > 0);
  }
  assert.equal(tag("battery").tag, "needs-review", "unspecified chemistry is not assumed to be lithium");
  assert.equal(tag("laptop").tag, "no-matching-rule", "installed-device batteries are different from spares");
});

test("knives, loose blades, power tools and substantial tools get checked-only tags", () => {
  for (const name of ["knife", "pocket knife", "razor blade", "box cutter", "straight razor", "power drill", "hammer", "chisel", "saw"]) {
    assert.equal(tag(name).tag, "checked-only", name);
  }
  assert.equal(tag("cordless drill").reviewRequired, true, "check its battery separately");
  assert.equal(tag("screwdriver").tag, "checked-only", "unmeasured tools use the requested conservative policy");
  assert.equal(tag("screwdriver").reviewRequired, true);
  assert.equal(tag("screwdriver", { toolLengthCm: 17.78 }).tag, "no-matching-rule");
  assert.equal(tag("wrench", { toolLengthCm: 17.79 }).tag, "checked-only");
});

test("blade exceptions and accessories do not inherit a device's restriction", () => {
  for (const name of ["disposable razor", "cartridge razor", "electric razor", "plastic knife", "round-bladed butter knife",
    "power bank cable", "knife sheath", "empty vape case"]) {
    assert.equal(tag(name).tag, "no-matching-rule", name);
  }
  assert.equal(tag("razor").tag, "needs-review");
  assert.equal(tag("scissors").tag, "needs-review");
  assert.equal(tag("scissors", { scissorsBladeLengthCm: 8 }).tag, "no-matching-rule");
  assert.equal(tag("scissors", { scissorsBladeLengthCm: 10.16 }).tag, "checked-only");
});

test("liquid and gel rules use individual container capacity and the exact 0.1 L boundary", () => {
  for (const name of ["shampoo", "hair gel", "toothpaste", "perfume", "sunscreen", "lotion", "water", "hair oil"]) {
    assert.equal(tag(name, { containerCapacityLiters: 0.099 }).tag, "no-matching-rule", name);
    assert.equal(tag(name, { containerCapacityLiters: 0.1 }).tag, "no-matching-rule", name);
    assert.equal(tag(name, { containerCapacityLiters: 0.101 }).tag, "checked-only", name);
    assert.equal(tag(name).tag, "needs-review", `${name}: unknown capacity`);
  }
  const many = tagBaggageRequirements([{ name: "shampoo", quantity: 20, containerCapacityLiters: 0.05 }])[0];
  assert.equal(many.baggage.tag, "no-matching-rule", "do not compare aggregate liters to the container threshold");
  assert.equal(many.quantity, 20, "tagging never changes quantities");
  assert.equal(tag("custom product", { physicalForm: "gel", containerCapacityLiters: 0.25 }).tag, "checked-only");
});

test("unknown capacity is not inferred from packed volume, and known solids or empty bottles are distinguished", () => {
  const [object] = tagBaggageRequirements([{ name: "shampoo", quantity: 1, volumeLiters: 0.25 }]);
  assert.equal(object.baggage.tag, "needs-review");
  assert.equal(tag("deodorant", { physicalForm: "solid" }).tag, "no-matching-rule");
  assert.equal(tag("water bottle", { isEmptyContainer: true, containerCapacityLiters: 1 }).tag, "no-matching-rule");
  assert.equal(tag("toiletry bag").tag, "needs-review");
});

test("medical, infant and duty-free liquids need exception review rather than an automatic checked-only label", () => {
  for (const name of ["liquid medication", "breast milk", "baby formula", "duty-free perfume"]) {
    assert.equal(tag(name, { containerCapacityLiters: 0.25 }).tag, "needs-review", name);
  }
  assert.equal(tag("liquid supplement", { containerCapacityLiters: 0.2, liquidException: "medical" }).tag, "needs-review");
});

test("vape liquid follows liquid rules, not the electronic smoking-device rule", () => {
  assert.equal(tag("vape juice", { containerCapacityLiters: 0.15 }).tag, "checked-only");
  assert.equal(tag("e-liquid", { containerCapacityLiters: 0.05 }).tag, "no-matching-rule");
  assert.equal(tag("vape liquid").tag, "needs-review");
});

test("aerosols are not treated as universally safe in checked bags", () => {
  assert.equal(tag("spray paint").tag, "prohibited");
  assert.equal(tag("WD-40").tag, "prohibited");
  assert.equal(tag("hairspray", { containerCapacityLiters: 0.6 }).tag, "prohibited");
  const aerosol = tag("hairspray", { containerCapacityLiters: 0.15 });
  assert.equal(aerosol.tag, "checked-only");
  assert.equal(aerosol.reviewRequired, true, "contents and aggregate limits still need checking");
});

test("conflicting mixed entries require splitting instead of arbitrarily choosing a bag", () => {
  assert.equal(tag("power bank and pocket knife").tag, "needs-review");
  assert.match(tag("power bank and pocket knife").reasons.join(" "), /split this mixed entry/);
});

test("tagging is repeatable, preserves counts and IDs, and never mutates the source list", () => {
  const objects = Object.freeze([Object.freeze({ id: "item-photo-knife", name: "knife", quantity: 8 })]);
  const once = tagBaggageRequirements(objects);
  assert.deepEqual(tagBaggageRequirements(once), once);
  assert.equal(once[0].id, "item-photo-knife");
  assert.equal(once[0].quantity, 8);
  assert.equal("baggage" in objects[0], false);
  for (const containerCapacityLiters of [NaN, Infinity, -1, 0]) {
    assert.throws(() => tag("shampoo", { containerCapacityLiters }), /positive finite/);
  }
});

test("image workflow adjusts counts once, removes suitcases, and then returns baggage tags without a second AI call", async () => {
  let calls = 0;
  const objects = await identifyObjectsInImage({ mimeType: "image/png", bytes: new Uint8Array([1]) }, { async identify() {
    calls++;
    return [["suitcase", 1], ["power bank", 7], ["knife", 1], ["shampoo", 1], ["shirt", 4]]
      .map(([label, count]) => ({ label, count, attributes: {}, flags: [] }));
  } });
  assert.equal(calls, 1);
  assert.deepEqual(objects.map(({ label, count, placement_tag }) => [label, count, placement_tag]), [
    ["power bank", 8, "carry-on-only"], ["knife", 1, "checked-only"],
    ["shampoo", 1, "needs-review"], ["shirt", 4, "no-matching-rule"],
  ] satisfies [string, number, BaggageTag][]);
});
