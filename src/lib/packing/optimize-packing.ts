import { indexById } from "../loads.ts";
import type {
  DimensionsCm,
  Item,
  ItemId,
  PackingPlan,
  PackWiseData,
  Suitcase,
  SuitcaseId,
} from "../types.ts";
import { boxVolumeLiters, fitsWithin } from "../units.ts";

export type PackingOptimizationInput = Pick<PackWiseData, "trip" | "items" | "suitcases" | "packingPlan">;

export type PackingRejectionReason = "carry-on-required" | "dimensions" | "weight" | "volume";

export interface UnassignedPackingItem {
  itemId: ItemId;
  message: string;
  /** Constraints that blocked each suitcase when this entry was considered. */
  suitcaseFailures: {
    suitcaseId: SuitcaseId;
    reasons: PackingRejectionReason[];
  }[];
}

export interface PackingOptimizationResult {
  packingPlan: PackingPlan;
  /** One explanation for every ID in packingPlan.unassignedItemIds. */
  unassignedItems: UnassignedPackingItem[];
}

interface BagState {
  suitcase: Suitcase;
  items: Item[];
  contentsWeightKg: number;
  usedLiters: number;
}

// Match suitcaseLoads: compare unrounded totals, allowing only floating-point noise.
const EPSILON = 1e-9;
const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/**
 * Required-first, constrained-first, first-fit decreasing packing heuristic.
 *
 * Each item entry is indivisible; weight and volume already include quantity.
 * Required carry-on entries go first, then entries with fewer individually
 * feasible empty bags. Ties use descending liters, descending kg, then ordinal
 * item ID. Optional entries try checked bags before carry-ons, then bag ID.
 * packOrder follows placement order within each bag; no T07 stacking rules apply.
 *
 * Returns a fresh plan with the existing ID, without changing any input. Current
 * assignments are ignored so invalid/overloaded assignments can be repaired.
 * Throws on malformed source entities, ID membership, or plan identity rather
 * than producing a plan from ambiguous or invalid inputs. Feasibility failures
 * are returned as unassigned entries, never placed in violation of constraints.
 *
 * This greedy pass does not prove infeasibility or guarantee simultaneous 3D
 * fit. Liters are estimates; dimensions only check each entry individually.
 * Notes, categories, fragility, and flight metadata do not introduce extra rules.
 */
export function optimizePacking(data: PackingOptimizationInput): PackingOptimizationResult {
  validateInput(data);

  const bags: BagState[] = [...data.suitcases]
    .sort((a, b) => Number(a.kind === "carry-on") - Number(b.kind === "carry-on") || compareIds(a.id, b.id))
    .map((suitcase) => ({ suitcase, items: [], contentsWeightKg: 0, usedLiters: 0 }));
  const entries = data.items.map((item) => ({
    item,
    eligibleBagCount: bags.filter((bag) => rejectionReasons(item, bag).length === 0).length,
  }));
  entries.sort((a, b) =>
    Number(b.item.carryOnRequired) - Number(a.item.carryOnRequired)
    || a.eligibleBagCount - b.eligibleBagCount
    || b.item.volumeLiters - a.item.volumeLiters
    || b.item.weightKg - a.item.weightKg
    || compareIds(a.item.id, b.item.id));

  const unassignedItems: UnassignedPackingItem[] = [];
  for (const { item } of entries) {
    const suitcaseFailures = bags.map((bag) => ({
      suitcaseId: bag.suitcase.id,
      reasons: rejectionReasons(item, bag),
    }));
    const targetIndex = suitcaseFailures.findIndex((failure) => failure.reasons.length === 0);
    if (targetIndex === -1) {
      unassignedItems.push({
        itemId: item.id,
        message: explainUnassigned(item, bags, suitcaseFailures),
        suitcaseFailures,
      });
      continue;
    }
    const target = bags[targetIndex];
    target.items.push(item);
    target.contentsWeightKg += item.weightKg;
    target.usedLiters += item.volumeLiters;
  }

  unassignedItems.sort((a, b) => compareIds(a.itemId, b.itemId));
  return {
    packingPlan: {
      id: data.packingPlan.id,
      tripId: data.trip.id,
      assignments: bags.flatMap(({ suitcase, items }) => items.map((item, index) => ({
        itemId: item.id,
        suitcaseId: suitcase.id,
        packOrder: index + 1,
      }))),
      unassignedItemIds: unassignedItems.map(({ itemId }) => itemId),
    },
    unassignedItems,
  };
}

function rejectionReasons(item: Item, bag: BagState): PackingRejectionReason[] {
  const { suitcase } = bag;
  if (item.carryOnRequired && suitcase.kind !== "carry-on") return ["carry-on-required"];
  const reasons: PackingRejectionReason[] = [];
  if (!fitsWithin(item.dimensionsCm, suitcase.dimensionsCm)) reasons.push("dimensions");
  if (bag.contentsWeightKg + item.weightKg + suitcase.emptyWeightKg > suitcase.maxWeightKg + EPSILON) {
    reasons.push("weight");
  }
  if (bag.usedLiters + item.volumeLiters > suitcase.capacityLiters + EPSILON) reasons.push("volume");
  return reasons;
}

function explainUnassigned(
  item: Item,
  bags: BagState[],
  failures: UnassignedPackingItem["suitcaseFailures"],
): string {
  if (item.carryOnRequired && !bags.some(({ suitcase }) => suitcase.kind === "carry-on")) {
    return "Add a carry-on with enough weight allowance, estimated volume, and suitable dimensions. This entry requires a carry-on and cannot be placed in checked baggage.";
  }
  if (bags.length === 0) {
    return "Add a suitcase with enough weight allowance, estimated volume, and suitable dimensions, then run packing again.";
  }
  const blocked = new Set(failures.flatMap(({ reasons }) => reasons));
  const actions: string[] = [];
  if (blocked.has("weight")) actions.push("reduce the packed weight or use a bag with more remaining weight allowance (including its empty weight)");
  if (blocked.has("volume")) actions.push("free estimated volume or use a bag with more capacity");
  if (blocked.has("dimensions")) actions.push("use a bag with larger dimensions or reduce this entry's packed size");
  const carryOn = item.carryOnRequired ? " Keep this entry in a carry-on." : "";
  return `This entry was not placed by this packing pass.${carryOn} To try again, ${actions.join("; ")}.`;
}

function validateInput(data: PackingOptimizationInput): void {
  requireId(data.trip.id, "trip-");
  requireId(data.packingPlan.id, "pack-");
  if (data.packingPlan.tripId !== data.trip.id) throw new Error("Packing plan must belong to the current trip.");
  validateMembership(data.items, data.trip.itemIds, "item-");
  validateMembership(data.suitcases, data.trip.suitcaseIds, "case-");

  for (const item of data.items) {
    if (![item.weightKg, item.volumeLiters].every(positiveFinite) || !validDimensions(item.dimensionsCm)) {
      throw new Error(`Item "${item.id}" needs positive finite weight, volume, and dimensions.`);
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new Error(`Item "${item.id}" needs a positive whole-number quantity.`);
    }
    if (typeof item.carryOnRequired !== "boolean") throw new Error(`Item "${item.id}" needs a carry-on requirement.`);
    if (item.volumeLiters > boxVolumeLiters(item.dimensionsCm) + EPSILON) {
      throw new Error(`Item "${item.id}" volume exceeds its bounding box; correct its volume or dimensions.`);
    }
  }
  for (const bag of data.suitcases) {
    if (![bag.maxWeightKg, bag.capacityLiters].every(positiveFinite) || !validDimensions(bag.dimensionsCm)
      || !Number.isFinite(bag.emptyWeightKg) || bag.emptyWeightKg < 0 || bag.emptyWeightKg > bag.maxWeightKg) {
      throw new Error(`Suitcase "${bag.id}" needs positive finite limits and dimensions, and an empty weight between zero and its total weight limit.`);
    }
    if (bag.kind !== "checked" && bag.kind !== "carry-on") throw new Error(`Suitcase "${bag.id}" needs a valid kind.`);
  }
}

function validateMembership<T extends { id: string }>(entities: T[], tripIds: string[], prefix: string): void {
  for (const entity of entities) requireId(entity.id, prefix);
  const indexed = indexById(entities);
  if (indexed.size !== entities.length) throw new Error(`Duplicate ${prefix} entity IDs; give every entry a unique ID.`);
  if (new Set(tripIds).size !== tripIds.length) throw new Error(`Trip repeats ${prefix} IDs; list each entry once.`);
  for (const id of tripIds) {
    if (!indexed.has(id)) throw new Error(`Trip references unknown ${prefix} ID "${id}".`);
  }
  if (tripIds.length !== entities.length) throw new Error(`Every ${prefix} entity must be listed in the trip's IDs.`);
}

function requireId(id: string, prefix: string): void {
  if (typeof id !== "string" || !id.startsWith(prefix) || id.length === prefix.length) {
    throw new Error(`Expected a stable ${prefix} ID; received "${id}".`);
  }
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validDimensions(dimensions: DimensionsCm): boolean {
  return [dimensions.lengthCm, dimensions.widthCm, dimensions.heightCm].every(positiveFinite);
}
