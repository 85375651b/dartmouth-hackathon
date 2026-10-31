import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  identifyObjectsInImage, ObjectIdentificationError, postprocessObjectCounts, tagIdentifiedObject,
} from "../src/lib/vision/identify-objects.ts";
import { ATTRIBUTE_RULES, type DetectedObject, type ObjectAttributes } from "../src/lib/vision/object-contract.ts";

const image = { mimeType: "image/png", bytes: new Uint8Array([1]) };
const object = (label: string, count = 1, attributes: ObjectAttributes = {}): DetectedObject => ({
  label, count, attributes, flags: Object.values(attributes).includes(null) ? ["attribute_uncertain"] : [],
});
const invalid = (raw: unknown) => assert.throws(() => postprocessObjectCounts([raw]),
  (error: unknown) => error instanceof ObjectIdentificationError && error.status === 502);

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/object-identification-cases.json", import.meta.url), "utf8")) as {
  case: string; description: string; raw_ai_output: unknown[]; expected: unknown[];
}[];
for (const fixture of fixtures) {
  test(`requested case (${fixture.case}): ${fixture.description}`, async () => {
    let calls = 0;
    const result = await identifyObjectsInImage(image, { async identify() { calls++; return fixture.raw_ai_output; } });
    assert.equal(calls, 1);
    assert.deepEqual(result, fixture.expected);
    for (const entry of result) {
      assert.deepEqual(Object.keys(entry), ["label", "count", "attributes", "flags", "placement_tag"]);
      assert.ok(Object.values(entry.attributes).every((value) => value === null || typeof value === "string"));
    }
  });
}

test("each permitted label accepts exactly its own enum or null; uncertainty is never guessed", () => {
  for (const rule of ATTRIBUTE_RULES) {
    for (const label of rule.labels) {
      for (const value of [...rule.values, null]) {
        const attributes = { [rule.key]: value } as ObjectAttributes;
        const [result] = postprocessObjectCounts([object(label, 1, attributes)]);
        assert.deepEqual(result.attributes, attributes);
        assert.deepEqual(result.flags, value === null ? ["attribute_uncertain"] : []);
      }
    }
  }
  assert.deepEqual(postprocessObjectCounts([{ ...object("laptop", 1, { type: null }), flags: [] }])[0].flags,
    ["attribute_uncertain"], "code may restore a missing flag, never invent a type");
  invalid(object("laptop", 1, { type: "boots_hiking" }));
  invalid(object("pouch", 1, { material: "steel" }));
  invalid(object("book", 1, { type: "standard" }));
  invalid(object("laptop"));
  invalid({ ...object("laptop", 1, { type: "standard" }), flags: ["attribute_uncertain"] });
});

test("different attribute values stay separate and the +1 threshold applies to each variant", () => {
  const result = postprocessObjectCounts([
    object("jacket", 3, { type: "down_puffer" }), object("jacket", 2, { type: "down_puffer" }),
    object("jacket", 4, { type: "shell_rain" }), object("jacket", 1, { type: null }),
  ]);
  assert.deepEqual(result, [object("jacket", 6, { type: "down_puffer" }), object("jacket", 4, { type: "shell_rain" }), object("jacket", 1, { type: null })]);
  assert.equal(postprocessObjectCounts([object("mug", 1, { material: "steel" }), object("mug", 1, { material: null })]).length, 2);
  assert.equal(postprocessObjectCounts([object("gaming laptop", 1, { type: "gaming_or_workstation" })])[0].label, "laptop");
  assert.equal(postprocessObjectCounts([object("hiking boot", 1, { type: "boots_hiking" })])[0].label, "shoes");
  assert.equal(postprocessObjectCounts([object("laptops", 2, { type: "standard" })])[0].label, "laptop");
  assert.equal(postprocessObjectCounts([object("__proto__")])[0].label, "__proto__", "label lookup never uses inherited properties");
  invalid(object("gaming laptop"));
  invalid(object("laptops"));
});

test("all extra attributes, measurements, model names, contents, and AI placement decisions are rejected", () => {
  for (const extra of [{ dimensions: {} }, { size: "large" }, { brand: "example" }, { model: "example" },
    { screen_size: 15 }, { thickness: 2 }, { page_count: 50 }, { children: [] }, { contents: [object("shirt")] },
    { containerCapacityLiters: 0.25 }, { placement_tag: "checked-only" }]) {
    invalid({ ...object("book"), ...extra });
  }
  invalid({ ...object("laptop", 1, { type: "standard" }), attributes: { type: "standard", screen_size: 15 } });
  invalid({ ...object("mug", 1, { material: "steel" }), attributes: { material: { value: "steel" } } });
  invalid({ ...object("power bank"), attributes: { capacity: 10000 } });
  invalid({ ...object("shirt"), flags: ["assumed_empty"] });
  assert.deepEqual(postprocessObjectCounts([object("book"), object("notebook"), object("power bank")]),
    [object("book"), object("notebook"), object("power bank")]);
});

test("bags/cases and drinking bottles are empty primitives; visible contents are separate", async () => {
  const result = await identifyObjectsInImage(image, { async identify() { return [
    object("toiletry bag", 1, { material: null }), object("box"), object("case"), object("drinking bottle", 1, { material: "plastic" }),
    object("flask", 1, { material: "steel" }), object("thermos", 1, { material: null }), object("shirt", 2),
  ]; } });
  for (const entry of result.slice(0, 6)) {
    assert.ok(entry.flags.includes("assumed_empty"));
    assert.equal(entry.placement_tag, "no-matching-rule");
    assert.ok(!("contents" in entry.attributes));
  }
  assert.deepEqual(result[6], { ...object("shirt", 2), placement_tag: "no-matching-rule" });
});

test("liquid products remain full, unknown container sizes need review, and known sizes are used outside attributes", () => {
  const shampoo = object("shampoo", 6);
  const unknown = tagIdentifiedObject(shampoo);
  assert.deepEqual(unknown, { ...shampoo, flags: ["assumed_full", "placement_review_required"], placement_tag: "needs-review" });
  const over = tagIdentifiedObject(shampoo, { containerCapacityLiters: 0.25 });
  assert.equal(over.placement_tag, "checked-only");
  assert.equal(over.count, 6);
  assert.deepEqual(over.attributes, {});
  assert.ok(!("containerCapacityLiters" in over));
  assert.equal(tagIdentifiedObject(shampoo, { containerCapacityLiters: 0.1 }).placement_tag, "no-matching-rule");
  assert.ok(tagIdentifiedObject(shampoo, { isEmptyContainer: true }).flags.includes("assumed_full"));
  const bottle = object("water bottle", 1, { material: "steel" });
  assert.equal(tagIdentifiedObject(bottle, { containerCapacityLiters: 1 }).placement_tag, "no-matching-rule");
});

test("tagging stays plain code and does not adjust counts or mutate attributes", () => {
  const raw = Object.freeze({ ...object("laptop", 1, { type: "gaming_or_workstation" }),
    attributes: Object.freeze({ type: "gaming_or_workstation" as const }), flags: [] });
  const tagged = tagIdentifiedObject(raw);
  assert.deepEqual(tagIdentifiedObject(tagged), tagged);
  assert.notEqual(tagged.attributes, raw.attributes);
  assert.equal(tagIdentifiedObject(object("power bank", 5)).count, 5, "only stage C adds one");
});
