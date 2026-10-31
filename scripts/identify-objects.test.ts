import assert from "node:assert/strict";
import { test } from "node:test";
import {
  identifyObjectsInImage, MAX_OBJECT_IMAGE_BYTES, ObjectIdentificationError,
  postprocessObjectCounts, type ObjectImage,
} from "../src/lib/vision/identify-objects.ts";
import { createClaudeObjectAgent } from "../src/lib/vision/claude-object-agent.ts";
import { POST } from "../src/app/api/identify-objects/route.ts";
import { createDemoData } from "../src/lib/demo-data.ts";
import { optimizePacking } from "../src/lib/packing/optimize-packing.ts";
import type { DetectedObject, ObjectAttributes } from "../src/lib/vision/object-contract.ts";

function object(label: string, count: number, attributes: ObjectAttributes = {}): DetectedObject {
  return { label, count, attributes, flags: Object.values(attributes).includes(null) ? ["attribute_uncertain"] : [] };
}

// A valid 1x1 PNG. Tests mock recognition, not photographic accuracy.
const image: ObjectImage = { mimeType: "image/png", bytes: Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZi8AAAAASUVORK5CYII=", "base64",
) };
const rawObjects = [
  object("shirt", 7), object("suitcase", 2), object("sock", 4), object("book", 5),
];
const expected = [object("shirt", 8), object("sock", 4), object("book", 6)];
const expectedTagged = expected.map((entry) => ({ ...entry, placement_tag: "no-matching-rule" }));
function completed(objects: unknown = rawObjects) {
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ objects }) }] };
}
const isErrorStatus = (status: number) => (error: unknown) => error instanceof ObjectIdentificationError && error.status === status;

test("exact postprocessing: remove suitcases, leave four unchanged, add one above four", () => {
  const raw = Object.freeze(rawObjects.map((entry) => Object.freeze({ ...entry })));
  assert.deepEqual(postprocessObjectCounts(raw), expected);
  assert.equal(raw[0].count, 7, "raw agent output stays unchanged");
  assert.deepEqual(postprocessObjectCounts([object("laptop", 1, { type: "standard" })]), [object("laptop", 1, { type: "standard" })]);
  assert.deepEqual(postprocessObjectCounts([]), []);
});

test("remove singular/plural and descriptive suitcase labels without removing backpacks", () => {
  assert.deepEqual(postprocessObjectCounts([
    object(" SUITCASES ", 7), object("blue suitcase", 1), object("suitcase cover", 1),
    object("backpack", 2, { material: "canvas" }),
  ]), [object("backpack", 2, { material: "canvas" })]);
  assert.deepEqual(postprocessObjectCounts([object("suitcase", 1)]), []);
});

test("merge duplicate labels before adjusting a group's total exactly once", () => {
  assert.deepEqual(postprocessObjectCounts([
    object(" T   shirt ", 3), object("t shirt", 4),
  ]), [object("t shirt", 8)]);
});

test("reject malformed, fractional, nonpositive, and unsafe model counts", () => {
  for (const raw of [null, {}, "7 shirts", [null], [object("", 1)],
    ...[0, -1, 1.5, "7", NaN, Infinity, Number.MAX_SAFE_INTEGER].map((count) => [{ ...object("shirt", 1), count }]),
  ]) assert.throws(() => postprocessObjectCounts(raw), isErrorStatus(502));
  assert.throws(() => postprocessObjectCounts([
    object("shirt", Number.MAX_SAFE_INTEGER - 1), object("shirt", 2),
  ]), isErrorStatus(502));
});

test("identify once and apply deterministic rules after the agent returns", async () => {
  let calls = 0;
  const result = await identifyObjectsInImage(image, { async identify(received) {
    calls++;
    assert.equal(received, image);
    return rawObjects;
  } });
  assert.deepEqual(result, expectedTagged);
  assert.equal(calls, 1);
});

test("invalid images are rejected before calling an agent", async () => {
  const agent = { async identify() { assert.fail("must not call AI for an invalid image"); } };
  await assert.rejects(identifyObjectsInImage({ ...image, bytes: new Uint8Array() }, agent), isErrorStatus(400));
  await assert.rejects(identifyObjectsInImage({ ...image, mimeType: "text/plain" }, agent), isErrorStatus(415));
  await assert.rejects(identifyObjectsInImage({ ...image, bytes: new Uint8Array(MAX_OBJECT_IMAGE_BYTES + 1) }, agent), isErrorStatus(413));
});

test("Claude adapter sends the image and a strict schema, preserving raw counts for postprocessing", async () => {
  const agent = createClaudeObjectAgent({ apiKey: "test-key", model: "test-vision-model", fetch: async (url, init) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal(init!.method, "POST");
    assert.equal(new Headers(init!.headers).get("x-api-key"), "test-key");
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, "test-vision-model");
    assert.equal(new Headers(init!.headers).get("anthropic-version"), "2023-06-01");
    assert.equal(body.output_config.format.type, "json_schema");
    const branches = body.output_config.format.schema.properties.objects.items.anyOf;
    assert.deepEqual(branches[0].required, ["label", "count", "attributes", "flags"]);
    assert.equal(branches[0].additionalProperties, false);
    assert.deepEqual(branches[0].properties.label.enum, ["laptop"]);
    // Nullable enum is an anyOf: Claude's schema checker rejects type ["string","null"] with an enum.
    assert.deepEqual(branches[0].properties.attributes.properties.type.anyOf,
      [{ type: "string", enum: ["ultrabook_thin_light", "standard", "gaming_or_workstation", "tablet_or_2in1"] }, { type: "null" }]);
    assert.ok(!JSON.stringify(branches).includes("placement_tag"), "AI does not supply baggage decisions");
    assert.match(body.system, /Never guess/);
    assert.match(body.system, /steel from aluminum/);
    assert.match(body.system, /page counts/);
    assert.match(body.system, /brands or specific model names/);
    assert.match(body.system, /containers? as EMPTY|cases as EMPTY/);
    const imagePart = body.messages[0].content.find((part: { type: string }) => part.type === "image");
    assert.equal(imagePart.source.type, "base64");
    assert.equal(imagePart.source.media_type, "image/png");
    assert.equal(imagePart.source.data, Buffer.from(image.bytes).toString("base64"));
    assert.ok(!JSON.stringify(branches).includes("minimum"));
    return Response.json(completed());
  } });
  assert.deepEqual(await agent.identify(image), rawObjects, "provider adapter does not adjust counts");
  assert.deepEqual(await identifyObjectsInImage(image, agent), expectedTagged);
});

test("provider errors, refusals, incomplete or malformed output never become an empty successful list", async () => {
  const responses = [
    new Response("private provider error", { status: 429 }),
    Response.json({ stop_reason: "max_tokens", content: [] }),
    Response.json({ stop_reason: "end_turn", content: [] }),
    Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: "not JSON" }] }),
    Response.json(completed(object("shirt", 7))),
    new Response("not JSON"),
  ];
  for (const response of responses) {
    const agent = createClaudeObjectAgent({ apiKey: "test-key", model: "test-model", fetch: async () => response });
    await assert.rejects(identifyObjectsInImage(image, agent), (error: unknown) =>
      isErrorStatus(502)(error) && !(error as Error).message.includes("private provider error"));
  }
  const refused = createClaudeObjectAgent({ apiKey: "test-key", model: "test-model", fetch: async () => Response.json({
    stop_reason: "refusal", content: [],
  }) });
  await assert.rejects(identifyObjectsInImage(image, refused), isErrorStatus(422));
  const timeout = createClaudeObjectAgent({ apiKey: "test-key", model: "test-model", fetch: async () => {
    throw new DOMException("timeout", "TimeoutError");
  } });
  await assert.rejects(identifyObjectsInImage(image, timeout), isErrorStatus(504));
  assert.throws(() => createClaudeObjectAgent({ apiKey: "", model: "" }), isErrorStatus(503));
  const oversized = createClaudeObjectAgent({ apiKey: 'test-key', model: 'test-model', fetch: async () => { assert.fail('Encoded-limit failures must not call Claude'); } });
  await assert.rejects(oversized.identify({ ...image, bytes: new Uint8Array(7_500_001) }), isErrorStatus(413));
});

function upload(file: Blob = new Blob([image.bytes as BlobPart], { type: image.mimeType })) {
  const form = new FormData();
  form.append("image", file, "objects.png");
  return new Request("http://localhost/api/identify-objects", { method: "POST", body: form });
}

test("upload route returns adjusted counts using a mocked provider; no credentials or images returned", async (t) => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousModel = process.env.ANTHROPIC_MODEL;
  const previousAlias = process.env.CLAUDE_API_KEY;
  t.after(() => {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.ANTHROPIC_MODEL; else process.env.ANTHROPIC_MODEL = previousModel;
    if (previousAlias === undefined) delete process.env.CLAUDE_API_KEY; else process.env.CLAUDE_API_KEY = previousAlias;
  });
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_MODEL = "test-model";
  delete process.env.CLAUDE_API_KEY;
  let providerObjects = rawObjects;
  t.mock.method(globalThis, "fetch", async () => Response.json(completed(providerObjects)));
  const response = await POST(upload());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const inventory = await response.json();
  assert.deepEqual(Object.keys(inventory), ["items", "bundles"]);
  assert.deepEqual(inventory.items.map(({ id, ...entry }: { id: string }) => {
    assert.match(id, /^item-photo-[a-f0-9]{16}$/);
    return entry;
  }), expectedTagged);
  assert.equal(new Set(inventory.items.map((entry: { id: string }) => entry.id)).size, expectedTagged.length);
  assert.deepEqual(inventory.bundles, []);
  const badRequest = await POST(new Request("http://localhost/api/identify-objects", { method: "POST", body: "not multipart" }));
  assert.equal(badRequest.status, 400);
  assert.equal((await POST(upload(new Blob([], { type: "image/png" })))).status, 400);
  assert.equal((await POST(upload(new Blob(["text"], { type: "text/plain" })))).status, 415);
  const duplicate = new FormData();
  duplicate.append("image", new Blob(["one"], { type: "image/png" }));
  duplicate.append("image", new Blob(["two"], { type: "image/png" }));
  assert.equal((await POST(new Request("http://localhost/api/identify-objects", { method: "POST", body: duplicate }))).status, 400);
  providerObjects = [object("shoes", 7, { type: "sneakers_running" })];
  const shoesResponse = await POST(upload());
  const shoesInventory = await shoesResponse.json();
  assert.equal(shoesResponse.status, 200);
  assert.equal(shoesInventory.items[0].count, 7);
  assert.equal(shoesInventory.bundles.length, 3);
  providerObjects = [object("aerosol spray paint", 1)];
  const conflict = await POST(upload());
  assert.equal(conflict.status, 422);
  assert.match((await conflict.json()).error, /conflicting or prohibited/);
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal((await POST(upload())).status, 503);
});

test("photo counts can become inventory drafts, but T06 still requires confirmed bundle measurements", () => {
  const counts = postprocessObjectCounts([object("shirt", 7)]);
  const data = createDemoData();
  data.items = [{ ...data.items[0], id: "item-photo-test", name: counts[0].label, quantity: counts[0].count,
    weightKg: null, volumeLiters: null, dimensionsCm: null }];
  data.trip.itemIds = ["item-photo-test"];
  assert.throws(() => optimizePacking(data), /needs positive finite weight, volume, and dimensions/);
  assert.equal(data.items[0].quantity, 8);
});
