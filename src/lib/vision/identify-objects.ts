import {
  isLiquidProductLabel, tagBaggageRequirements, type BaggageDetails, type BaggageTag,
} from "../packing/baggage-tags.ts";
import {
  attributeRuleForLabel, isAssumedEmptyLabel, normalizeObjectLabel,
  type DetectedObject, type ObjectAttributes, type ObjectFlag,
} from "./object-contract.ts";

export type { DetectedObject, ObjectAttributes, ObjectFlag } from "./object-contract.ts";
export type TaggedDetectedObject = DetectedObject & { placement_tag: BaggageTag };

export interface ObjectImage {
  bytes: Uint8Array;
  mimeType: string;
}

/** The agent returns raw, unadjusted counts. Runtime validation happens below. */
export interface ObjectIdentificationAgent {
  identify(image: ObjectImage): Promise<unknown>;
}

export const MAX_OBJECT_IMAGE_BYTES = 10 * 1024 * 1024;

export class ObjectIdentificationError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ObjectIdentificationError";
    this.status = status;
  }
}

export function validateObjectImage(image: ObjectImage): void {
  if (!["image/jpeg", "image/png", "image/webp"].includes(image.mimeType)) {
    throw new ObjectIdentificationError("Upload a JPEG, PNG, or WebP image.", 415);
  }
  if (!(image.bytes instanceof Uint8Array) || image.bytes.byteLength === 0) {
    throw new ObjectIdentificationError("The image must not be empty.", 400);
  }
  if (image.bytes.byteLength > MAX_OBJECT_IMAGE_BYTES) {
    throw new ObjectIdentificationError("The image must be 10 MiB or smaller.", 413);
  }
}

/**
 * Deterministic postprocessing of RAW model output; no AI calls here.
 * B: remove suitcases. C: group by label + attributes, then add exactly one
 * to each group's AI count greater than four. Never reprocess adjusted output.
 */
export function postprocessObjectCounts(rawObjects: unknown): DetectedObject[] {
  if (!Array.isArray(rawObjects)) {
    throw new ObjectIdentificationError("The agent returned an invalid object list.", 502);
  }
  const groups = new Map<string, DetectedObject>();
  for (const raw of rawObjects) {
    const object = validateDetectedObject(raw);
    if (/\bsuitcases?\b/.test(object.label)) continue;
    const key = JSON.stringify([object.label, object.attributes]);
    const previous = groups.get(key);
    const count = (previous?.count ?? 0) + object.count;
    // Reserve room for the requested +1 correction without losing precision.
    if (!Number.isSafeInteger(count) || count >= Number.MAX_SAFE_INTEGER) {
      throw new ObjectIdentificationError("The agent returned a count that is too large.", 502);
    }
    groups.set(key, { ...object, count });
  }
  return Array.from(groups.values(), (object) => ({ ...object, count: object.count > 4 ? object.count + 1 : object.count }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidOutput(message: string): never {
  throw new ObjectIdentificationError(message, 502);
}

function validateDetectedObject(raw: unknown): DetectedObject {
  if (!isRecord(raw) || typeof raw.label !== "string" || !raw.label.trim()
    || typeof raw.count !== "number" || !Number.isSafeInteger(raw.count) || raw.count < 1
    || !isRecord(raw.attributes) || !Array.isArray(raw.flags)
    || Object.keys(raw).length !== 4 || !["label", "count", "attributes", "flags"].every((key) => Object.hasOwn(raw, key))) {
    return invalidOutput("Each object needs only label, positive integer count, attributes, and flags.");
  }
  if (raw.flags.some((flag: unknown) => flag !== "attribute_uncertain")) {
    return invalidOutput("The agent may only supply the attribute_uncertain flag; placement and container policy are handled in code.");
  }
  const label = normalizeObjectLabel(raw.label);
  const rule = attributeRuleForLabel(label);
  let attributes: ObjectAttributes = {};
  let flags: ObjectFlag[] = [];
  if (rule) {
    const value = raw.attributes[rule.key];
    if (Object.keys(raw.attributes).length !== 1 || !Object.hasOwn(raw.attributes, rule.key)
      || (value !== null && !rule.values.some((allowed) => allowed === value))) {
      return invalidOutput("Attributes must match the label's permitted type/material enum or be null.");
    }
    if (value !== null && raw.flags.includes("attribute_uncertain")) {
      return invalidOutput("An uncertain attribute must be null, not a guessed value.");
    }
    attributes = { [rule.key]: value } as ObjectAttributes;
    // A missing uncertainty flag can be restored without guessing an attribute.
    flags = value === null ? ["attribute_uncertain"] : [];
  } else if (Object.keys(raw.attributes).length !== 0 || raw.flags.length !== 0) {
    return invalidOutput("Labels outside the attribute whitelist must have attributes {} and flags [].");
  }
  return { label, count: raw.count, attributes, flags };
}

/** D: plain-code policy. Facts are separate confirmed inputs, never public attributes.
 * Re-run this stage after confirming a liquid container size; counts stay intact.
 */
export function tagIdentifiedObject(object: DetectedObject, details: BaggageDetails = {}): TaggedDetectedObject {
  const empty = isAssumedEmptyLabel(object.label);
  const fullProduct = !empty && details.physicalForm !== "solid" && isLiquidProductLabel(object.label);
  const [tagged] = tagBaggageRequirements([{
    // An empty toiletry/battery case does not imply anything about its contents.
    name: empty ? "empty container" : object.label,
    ...details,
    isEmptyContainer: empty ? true : fullProduct ? false : details.isEmptyContainer,
  }]);
  const flags: ObjectFlag[] = object.flags.filter((flag) => flag === "attribute_uncertain");
  if (empty) flags.push("assumed_empty");
  else if (fullProduct) flags.push("assumed_full");
  if (tagged.baggage.reviewRequired) flags.push("placement_review_required");
  return {
    label: object.label, count: object.count, attributes: { ...object.attributes },
    flags, placement_tag: tagged.baggage.tag,
  };
}

export async function identifyObjectsInImage(
  image: ObjectImage,
  agent: ObjectIdentificationAgent,
): Promise<TaggedDetectedObject[]> {
  validateObjectImage(image);
  const rawObjects = await agent.identify(image);
  return postprocessObjectCounts(rawObjects).map((object) => tagIdentifiedObject(object));
}
