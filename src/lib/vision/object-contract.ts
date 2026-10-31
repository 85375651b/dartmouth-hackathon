/** Local vision DTOs. Shared Item types and T06 measurements remain unchanged. */
export const ATTRIBUTE_RULES = [
  { labels: ["laptop"], key: "type", values: ["ultrabook_thin_light", "standard", "gaming_or_workstation", "tablet_or_2in1"] },
  { labels: ["shoes"], key: "type", values: ["sandals_flipflops", "sneakers_running", "boots_hiking", "dress_shoes"] },
  { labels: ["jacket", "coat"], key: "type", values: ["down_puffer", "synthetic_puffer", "shell_rain", "fleece", "leather", "denim", "wool_coat", "other"] },
  { labels: ["mug", "cup", "drinking vessel", "drinking bottle", "water bottle", "flask", "thermos"], key: "material", values: ["ceramic", "glass", "plastic", "steel", "other"] },
  { labels: ["bag", "backpack", "tote", "duffel", "pouch"], key: "material", values: ["nylon_synthetic", "canvas", "leather", "other"] },
] as const;

type TypeValue = typeof ATTRIBUTE_RULES[0 | 1 | 2]["values"][number];
type MaterialValue = typeof ATTRIBUTE_RULES[3 | 4]["values"][number];
export type ObjectAttributes = Record<string, never> | { type: TypeValue | null } | { material: MaterialValue | null };
export type ObjectFlag = "attribute_uncertain" | "assumed_empty" | "assumed_full" | "placement_review_required";

export interface DetectedObject {
  label: string;
  count: number;
  attributes: ObjectAttributes;
  flags: ObjectFlag[];
}

const LABEL_ALIASES: Readonly<Record<string, string>> = {
  laptops: "laptop", jackets: "jacket", coats: "coat", mugs: "mug", cups: "cup",
  bags: "bag", backpacks: "backpack", totes: "tote", duffels: "duffel", pouches: "pouch",
  "drinking bottles": "drinking bottle", "water bottles": "water bottle", flasks: "flask", thermoses: "thermos",
  shoe: "shoes", sneakers: "shoes", sneaker: "shoes", boots: "shoes", boot: "shoes",
  sandals: "shoes", sandal: "shoes", "flip flops": "shoes", "flip-flops": "shoes",
  "running shoe": "shoes", "running shoes": "shoes", "hiking boot": "shoes", "hiking boots": "shoes",
  "dress shoe": "shoes", "dress shoes": "shoes", "flip flop": "shoes", "flip-flop": "shoes",
  "tote bag": "tote", "duffel bag": "duffel", "duffle bag": "duffel", duffle: "duffel",
  rucksack: "backpack", "zippered pouch": "pouch", "closed pouch": "pouch", "toiletry bag": "bag",
  "rain jacket": "jacket", "winter jacket": "jacket", "winter coat": "coat",
  "notebook computer": "laptop", "gaming laptop": "laptop", "workstation laptop": "laptop", ultrabook: "laptop",
  "steel mug": "mug", "metal mug": "mug",
  "coffee mug": "mug", "coffee cup": "cup", "drinking cup": "cup", "drinking glass": "drinking vessel",
  bottle: "drinking bottle", "reusable bottle": "drinking bottle", "drinking flask": "flask",
  powerbank: "power bank", "power banks": "power bank", "portable charger": "power bank",
};

export function normalizeObjectLabel(label: string): string {
  const normalized = label.trim().replace(/\s+/g, " ").toLowerCase();
  return Object.hasOwn(LABEL_ALIASES, normalized) ? LABEL_ALIASES[normalized] : normalized;
}

export function attributeRuleForLabel(label: string) {
  return ATTRIBUTE_RULES.find((rule) => rule.labels.some((candidate) => candidate === label));
}

export function isAssumedEmptyLabel(label: string): boolean {
  return ["bag", "backpack", "tote", "duffel", "pouch", "box", "case", "drinking bottle", "water bottle", "flask", "thermos"].includes(label)
    || /\b(?:bag|pouch|box|case)$/.test(label);
}

const commonProperties = {
  count: { type: "integer", minimum: 1 },
  flags: { type: "array", items: { type: "string", enum: ["attribute_uncertain"] } },
};
const required = ["label", "count", "attributes", "flags"];

/** The AI never supplies placement_tag, container contents, or measurements.
 * Branches restrict attributes; runtime validation also ties them to the label.
 */
export const OBJECT_IDENTIFICATION_SCHEMA = {
  type: "object",
  properties: {
    objects: {
      type: "array",
      items: {
        anyOf: [
          ...ATTRIBUTE_RULES.map((rule) => ({
            type: "object",
            properties: {
              label: { type: "string", enum: [...rule.labels] },
              ...commonProperties,
              attributes: {
                type: "object",
                // Claude's schema checker rejects `type: ["string","null"]` combined with an enum.
                properties: { [rule.key]: { anyOf: [{ type: "string", enum: [...rule.values] }, { type: "null" }] } },
                required: [rule.key],
                additionalProperties: false,
              },
            },
            required,
            additionalProperties: false,
          })),
          {
            type: "object",
            properties: {
              label: { type: "string" }, ...commonProperties,
              attributes: { type: "object", properties: {}, required: [], additionalProperties: false },
            },
            required,
            additionalProperties: false,
          },
        ],
      },
    },
  },
  required: ["objects"],
  additionalProperties: false,
};
