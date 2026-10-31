import { createHash } from "node:crypto";
import type { ItemId } from "../types.ts";
import type { TaggedDetectedObject } from "../vision/identify-objects.ts";
import type { ObjectFlag } from "../vision/object-contract.ts";

export type PackingItemFlag = ObjectFlag | "unpaired_shoe" | "shoe_count_correction_removed";
export type BundlePlacementTag = "carry_on_only" | "checked_only" | "either" | "needs_review" | "prohibited";
export type BundleFlag = PackingItemFlag | "carry_on_only_member";
export type PackingInventoryItem = Omit<TaggedDetectedObject, "flags"> & { id: ItemId; flags: PackingItemFlag[] };
export type BundleInputItem = Omit<TaggedDetectedObject, "flags"> & { id?: ItemId; flags: readonly PackingItemFlag[] };

export interface PackingBundle {
  bundle_id: string;
  kind: "shoe_pair" | "liquids";
  members: { item_id: ItemId; qty: number }[];
  placement_tag: BundlePlacementTag;
  flags: BundleFlag[];
}

export interface PackingInventory {
  /** The only input to the mass stage. Bundle members reference these IDs. */
  items: PackingInventoryItem[];
  bundles: PackingBundle[];
}

export class BundleInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleInvariantError";
  }
}

const MAX_SHOE_PAIRS = 10_000;
const ITEM_PLACEMENT = {
  "carry-on-only": "carry_on_only", "checked-only": "checked_only",
  "no-matching-rule": "either", "needs-review": "needs_review", prohibited: "prohibited",
} as const;
const ALLOWED_BAGS: Record<BundlePlacementTag, readonly string[]> = {
  carry_on_only: ["carry-on"], checked_only: ["checked"], either: ["carry-on", "checked"],
  needs_review: ["carry-on", "checked"], prohibited: [],
};
const pairId = (itemId: ItemId, ordinal: number) => `shoe_pair:${itemId}:${ordinal}`;
const isLiquid = (item: BundleInputItem) => item.flags.includes("assumed_full") && !item.flags.includes("assumed_empty");
function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new BundleInvariantError(message);
}

/** Stable for an attribute group across reordering and count/flag changes.
 * Preserve a supplied ID when an existing inventory entry is being updated.
 */
export function packingItemId(item: Pick<BundleInputItem, "label" | "attributes">): ItemId {
  const attributes = Object.entries(item.attributes).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const digest = createHash("sha256").update(JSON.stringify([item.label, attributes])).digest("hex").slice(0, 16);
  return `item-photo-${digest}`;
}

/** F only. Input counts have already passed through the unchanged +1 stage.
 * Undo the synthetic shoe increment, then keep real odd shoes unbundled, as
 * required by explicit example (b). No input or placement tag is mutated.
 */
export function bundlePackingItems(input: readonly BundleInputItem[]): PackingInventory {
  const items: PackingInventoryItem[] = input.map((source) => {
    invariant(Number.isSafeInteger(source.count) && source.count > 0, "Item counts must be positive safe integers.");
    const flags = new Set<PackingItemFlag>(source.flags);
    let count = source.count;
    if (source.label === "shoes") {
      // Stage C's outputs above four begin at six, so count > 5 means +1 ran.
      if (count > 5 && !flags.has("shoe_count_correction_removed")) {
        count--;
        flags.add("shoe_count_correction_removed");
      }
      flags.delete("unpaired_shoe");
      if (count % 2 === 1) flags.add("unpaired_shoe");
    }
    return {
      id: source.id ?? packingItemId(source), label: source.label, count,
      attributes: { ...source.attributes }, flags: [...flags], placement_tag: source.placement_tag,
    };
  });
  const ids = new Set<ItemId>();
  let pairs = 0;
  for (const item of items) {
    invariant(/^item-.+/.test(item.id) && !ids.has(item.id), "Item IDs must be unique stable item- strings. Preserve distinct IDs for separate entries.");
    ids.add(item.id);
    if (item.label === "shoes") pairs += Math.floor(item.count / 2);
  }
  invariant(pairs <= MAX_SHOE_PAIRS, `A photo may generate at most ${MAX_SHOE_PAIRS} shoe-pair bundles.`);

  const bundles: PackingBundle[] = [];
  for (const item of items) {
    if (item.label !== "shoes") continue;
    for (let ordinal = 1; ordinal <= Math.floor(item.count / 2); ordinal++) {
      bundles.push({ bundle_id: pairId(item.id, ordinal), kind: "shoe_pair",
        members: [{ item_id: item.id, qty: 2 }], placement_tag: ITEM_PLACEMENT[item.placement_tag],
        // This flag refers to the unbundled remainder, never a complete pair.
        flags: item.flags.filter((flag) => flag !== "unpaired_shoe" && flag !== "shoe_count_correction_removed"),
      });
    }
  }
  for (const checked of [false, true]) {
    const liquids = items.filter((item) => isLiquid(item) && (item.placement_tag === "checked-only") === checked)
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (!liquids.length) continue;
    const flags = new Set<BundleFlag>(liquids.flatMap((item) => item.flags));
    if (liquids.some((item) => item.placement_tag === "carry-on-only")) flags.add("carry_on_only_member");
    bundles.push({ bundle_id: checked ? "liquids_checked" : "liquids_cabin", kind: "liquids",
      members: liquids.map((item) => ({ item_id: item.id, qty: item.count })),
      placement_tag: checked ? "checked_only" : "either", flags: [...flags],
    });
  }
  const result = { items, bundles };
  assertBundleInvariants(result);
  return result;
}

/** Fail closed on invalid references, overlapping shoe slots, excessive use,
 * conflicting bag requirements, and any extra bundle fields (including mass).
 * Pair ordinal k owns units [2k-1, 2k]; distinct ordinals cannot claim a unit twice.
 */
export function assertBundleInvariants({ items, bundles }: PackingInventory): void {
  const byId = new Map<ItemId, PackingInventoryItem>();
  for (const item of items) {
    invariant(typeof item.id === "string" && /^item-.+/.test(item.id) && !byId.has(item.id), "Duplicate or invalid item ID.");
    invariant(Number.isSafeInteger(item.count) && item.count > 0, "Item count must be a positive safe integer.");
    invariant(Object.hasOwn(ITEM_PLACEMENT, item.placement_tag), "Unknown item placement tag.");
    byId.set(item.id, item);
  }
  const used = new Map<ItemId, number>();
  const bundleIds = new Set<string>();
  const pairSlots = new Set<string>();
  const liquidAllocations = new Set<ItemId>();
  for (const bundle of bundles) {
    invariant(Object.keys(bundle).length === 5 && ["bundle_id", "kind", "members", "placement_tag", "flags"].every((key) => Object.hasOwn(bundle, key)),
      "Bundles must contain only ID, kind, members, placement tag and flags; bundles carry no mass.");
    invariant(typeof bundle.bundle_id === "string" && bundle.bundle_id.length > 0 && !bundleIds.has(bundle.bundle_id), "Duplicate or invalid bundle ID claims the same packing unit twice.");
    bundleIds.add(bundle.bundle_id);
    invariant(bundle.kind === "shoe_pair" || bundle.kind === "liquids", "Unknown bundle kind.");
    invariant(Object.hasOwn(ALLOWED_BAGS, bundle.placement_tag), "Unknown bundle placement tag.");
    invariant(Array.isArray(bundle.flags) && bundle.flags.every((flag) => typeof flag === "string"), "Bundle flags must be strings.");
    invariant(Array.isArray(bundle.members) && bundle.members.length > 0, "Empty bundle.");
    const memberIds = new Set<ItemId>();
    let allowed = [...ALLOWED_BAGS[bundle.placement_tag]];
    for (const member of bundle.members) {
      invariant(Object.keys(member).length === 2 && Object.hasOwn(member, "item_id") && Object.hasOwn(member, "qty"), "Bundle members contain only item_id and qty, never mass or copied item data.");
      invariant(!memberIds.has(member.item_id), "A bundle lists the same member twice.");
      memberIds.add(member.item_id);
      const item = byId.get(member.item_id);
      invariant(item, "Bundle references an unknown item ID.");
      invariant(Number.isSafeInteger(member.qty) && member.qty > 0, "Member qty must be a positive safe integer.");
      const nextUsed = (used.get(item.id) ?? 0) + member.qty;
      invariant(Number.isSafeInteger(nextUsed) && nextUsed <= item.count, "Bundled qty exceeds the item's count or claims units twice.");
      used.set(item.id, nextUsed);
      allowed = allowed.filter((bag) => ALLOWED_BAGS[ITEM_PLACEMENT[item.placement_tag]].includes(bag));
      invariant(allowed.length > 0, "Bundle members have conflicting or prohibited placement tags.");
      if (item.placement_tag === "needs-review" || item.flags.includes("placement_review_required")) {
        invariant(bundle.flags.includes("placement_review_required"), "A bundle must retain its members' placement-review requirement.");
      }
      if (bundle.kind === "shoe_pair") {
        invariant(item.label === "shoes" && bundle.members.length === 1 && member.qty === 2, "A shoe pair must contain exactly two shoes from one entry.");
        const prefix = `shoe_pair:${item.id}:`;
        invariant(bundle.bundle_id.startsWith(prefix), "Shoe-pair ID must identify its source entry and unit slot.");
        const suffix = bundle.bundle_id.slice(prefix.length);
        const ordinal = Number(suffix);
        invariant(/^[1-9]\d*$/.test(suffix) && Number.isSafeInteger(ordinal) && ordinal <= Math.floor(item.count / 2), "Shoe-pair unit slot is outside the item's count.");
        const slot = pairId(item.id, ordinal);
        invariant(!pairSlots.has(slot), "Two bundles claim the same pair of shoes.");
        pairSlots.add(slot);
        invariant(bundle.placement_tag === ITEM_PLACEMENT[item.placement_tag], "A shoe pair must preserve its item's placement tag.");
        invariant(!bundle.flags.includes("unpaired_shoe"), "A complete pair cannot be marked as an unpaired shoe.");
      } else {
        invariant(isLiquid(item) && !liquidAllocations.has(item.id) && member.qty === item.count, "Liquid products must be included once, in full, using the earlier liquid flag.");
        liquidAllocations.add(item.id);
        const checked = item.placement_tag === "checked-only";
        invariant(bundle.bundle_id === (checked ? "liquids_checked" : "liquids_cabin")
          && bundle.placement_tag === (checked ? "checked_only" : "either"), "Liquids must use the earlier placement tag's exact bucket.");
        if (item.placement_tag === "carry-on-only") invariant(bundle.flags.includes("carry_on_only_member"), "Cabin liquid bundle must retain carry-on-only member constraints.");
      }
    }
  }
  for (const item of items) {
    if (isLiquid(item)) invariant(liquidAllocations.has(item.id), "Every earlier-tagged liquid product must appear in a liquids bundle, including singletons.");
    if (item.label === "shoes" && item.count % 2 === 1) invariant(item.flags.includes("unpaired_shoe"), "The odd leftover shoe must be flagged.");
  }
}

/** Packing reads these residual quantities alongside bundles, never the full
 * source count again. Weight estimation continues to read inventory.items only.
 */
export function getUnbundledPackingItems(inventory: PackingInventory): PackingInventoryItem[] {
  assertBundleInvariants(inventory);
  const used = new Map<ItemId, number>();
  for (const bundle of inventory.bundles) {
    for (const { item_id, qty } of bundle.members) used.set(item_id, (used.get(item_id) ?? 0) + qty);
  }
  return inventory.items.flatMap((item) => {
    const count = item.count - (used.get(item.id) ?? 0);
    return count > 0 ? [{ ...item, attributes: { ...item.attributes }, flags: [...item.flags], count }] : [];
  });
}
