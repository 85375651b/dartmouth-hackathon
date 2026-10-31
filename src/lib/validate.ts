import { indexById, roomZoneLoads, suitcaseLoads } from "./loads.ts";
import type { PackWiseData } from "./types.ts";
import { boxVolumeLiters, fitsWithin } from "./units.ts";
import { roomZoneDraft, validateRoomZoneDraft } from "./room-zones.ts";

export interface ValidationResult {
  /** Broken data: dangling IDs, duplicates, impossible values, over-limit plans. */
  errors: string[];
  /** Questionable but allowed, e.g. an item placed in an unusual zone. */
  warnings: string[];
}

/**
 * Checks referential integrity and physical limits of a PackWise dataset.
 * Pure and dependency-free so it can run in the browser or in Node.
 */
export function validatePackWiseData(data: PackWiseData): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { trip, items, suitcases, roomZones, packingPlan, unpackingPlan } = data;

  const itemsById = indexById(items);
  const suitcasesById = indexById(suitcases);
  const zonesById = indexById(roomZones);

  for (const [label, list] of [
    ["item", items],
    ["suitcase", suitcases],
    ["room zone", roomZones],
  ] as const) {
    const seen = new Set<string>();
    for (const { id } of list) {
      if (seen.has(id)) errors.push(`Duplicate ${label} ID "${id}".`);
      seen.add(id);
    }
  }

  // Trip references
  for (const id of trip.itemIds) if (!itemsById.has(id)) errors.push(`Trip lists unknown item "${id}".`);
  for (const id of trip.suitcaseIds) if (!suitcasesById.has(id)) errors.push(`Trip lists unknown suitcase "${id}".`);
  for (const id of trip.roomZoneIds) if (!zonesById.has(id)) errors.push(`Trip lists unknown room zone "${id}".`);
  if (new Set(trip.roomZoneIds).size !== trip.roomZoneIds.length || roomZones.some((zone) => !trip.roomZoneIds.includes(zone.id))) {
    errors.push("Trip room-zone IDs must match the room-zone collection without duplicates.");
  }
  for (const zone of roomZones) {
    for (const message of Object.values(validateRoomZoneDraft(roomZoneDraft(zone)))) errors.push(`Zone "${zone.id}": ${message}`);
  }

  // Physical values
  for (const item of items) {
    const { lengthCm, widthCm, heightCm } = item.dimensionsCm;
    if ([item.weightKg, item.volumeLiters, lengthCm, widthCm, heightCm].some((v) => !(v > 0))) {
      errors.push(`Item "${item.id}" must have positive weight, volume, and dimensions.`);
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      errors.push(`Item "${item.id}" must have a whole-number quantity of at least 1.`);
    }
    if (item.volumeLiters > boxVolumeLiters(item.dimensionsCm) + 1e-9) {
      errors.push(`Item "${item.id}" volume exceeds its bounding box.`);
    }
  }

  // Packing plan
  if (packingPlan.tripId !== trip.id) errors.push(`Packing plan belongs to "${packingPlan.tripId}", not "${trip.id}".`);
  const packed = new Set<string>();
  for (const a of packingPlan.assignments) {
    const item = itemsById.get(a.itemId);
    const suitcase = suitcasesById.get(a.suitcaseId);
    if (!item) errors.push(`Packing assignment references unknown item "${a.itemId}".`);
    if (!suitcase) errors.push(`Packing assignment references unknown suitcase "${a.suitcaseId}".`);
    if (packed.has(a.itemId)) errors.push(`Item "${a.itemId}" is packed more than once.`);
    packed.add(a.itemId);
    if (item && suitcase) {
      if (item.carryOnRequired && suitcase.kind !== "carry-on") {
        errors.push(`Item "${item.id}" must travel in a carry-on, not "${suitcase.id}".`);
      }
      if (!fitsWithin(item.dimensionsCm, suitcase.dimensionsCm)) {
        errors.push(`Item "${item.id}" does not fit inside "${suitcase.id}".`);
      }
    }
  }
  for (const id of packingPlan.unassignedItemIds) {
    if (!itemsById.has(id)) errors.push(`Packing plan leaves out unknown item "${id}".`);
    if (packed.has(id)) errors.push(`Item "${id}" is both packed and unassigned.`);
  }
  for (const item of items) {
    if (!packed.has(item.id) && !packingPlan.unassignedItemIds.includes(item.id)) {
      warnings.push(`Item "${item.id}" is neither packed nor marked unassigned.`);
    }
  }
  for (const load of suitcaseLoads(data)) {
    if (load.overWeight) {
      errors.push(`"${load.suitcase.id}" weighs ${load.totalWeightKg} kg; limit is ${load.suitcase.maxWeightKg} kg.`);
    }
    if (load.overVolume) {
      errors.push(`"${load.suitcase.id}" holds ${load.usedLiters} L; capacity is ${load.suitcase.capacityLiters} L.`);
    }
  }

  // Unpacking plan
  if (unpackingPlan.tripId !== trip.id) errors.push(`Unpacking plan belongs to "${unpackingPlan.tripId}", not "${trip.id}".`);
  if (unpackingPlan.packingPlanId !== packingPlan.id) {
    errors.push(`Unpacking plan follows "${unpackingPlan.packingPlanId}", not "${packingPlan.id}".`);
  }
  const placed = new Set<string>();
  for (const a of unpackingPlan.assignments) {
    const item = itemsById.get(a.itemId);
    const zone = zonesById.get(a.roomZoneId);
    if (!item) errors.push(`Unpacking assignment references unknown item "${a.itemId}".`);
    if (!zone) errors.push(`Unpacking assignment references unknown room zone "${a.roomZoneId}".`);
    if (placed.has(a.itemId)) errors.push(`Item "${a.itemId}" is placed more than once.`);
    placed.add(a.itemId);
    if (item && !packed.has(item.id)) warnings.push(`Item "${item.id}" is placed in the room but never packed.`);
    if (item && zone && zone.suitableCategories.length > 0 && !zone.suitableCategories.includes(item.category)) {
      warnings.push(`Item "${item.id}" (${item.category}) is placed in "${zone.id}", which is not meant for that category.`);
    }
  }
  for (const id of unpackingPlan.unassignedItemIds) {
    if (!itemsById.has(id)) errors.push(`Unpacking plan leaves out unknown item "${id}".`);
    if (placed.has(id)) errors.push(`Item "${id}" is both placed and unassigned.`);
  }
  for (const load of roomZoneLoads(data)) {
    if (load.items.length && load.needsConfirmation) warnings.push(`"${load.zone.id}" has assignments requiring availability confirmation.`);
    if (load.items.length && load.overVolume === null) warnings.push(`"${load.zone.id}" has unknown capacity; fit has not been checked.`);
    if (load.overVolume) {
      errors.push(`"${load.zone.id}" holds ${load.usedLiters} L; capacity is ${load.zone.capacityLiters} L.`);
    }
  }

  return { errors, warnings };
}
