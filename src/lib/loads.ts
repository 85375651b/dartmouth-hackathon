import type {
  Item,
  ItemId,
  Kilograms,
  Liters,
  PackWiseData,
  RoomZone,
  Suitcase,
} from "./types.ts";

/** Builds an ID → entity lookup. Duplicate IDs keep the last entry. */
export function indexById<T extends { id: string }>(entities: T[]): Map<T["id"], T> {
  return new Map(entities.map((entity) => [entity.id, entity]));
}

export interface SuitcaseLoad {
  suitcase: Suitcase;
  /** Items in pack order (bottom first). */
  items: Item[];
  contentsWeightKg: Kilograms;
  /** Contents plus the empty suitcase; compare with `maxWeightKg`. */
  totalWeightKg: Kilograms;
  usedLiters: Liters;
  overWeight: boolean;
  overVolume: boolean;
}

export function suitcaseLoads(data: PackWiseData): SuitcaseLoad[] {
  const items = indexById(data.items);
  return data.suitcases.map((suitcase) => {
    const packed = data.packingPlan.assignments
      .filter((a) => a.suitcaseId === suitcase.id)
      .sort((a, b) => a.packOrder - b.packOrder)
      .map((a) => items.get(a.itemId))
      .filter((item): item is Item => item !== undefined);
    const contentsWeightKg = sum(packed, (i) => i.weightKg ?? 0);
    const totalWeightKg = contentsWeightKg + suitcase.emptyWeightKg;
    const usedLiters = sum(packed, (i) => i.volumeLiters ?? 0);
    return {
      suitcase,
      items: packed,
      contentsWeightKg,
      totalWeightKg,
      usedLiters,
      // Compare unrounded totals so decimal limits cannot hide an overload.
      overWeight: totalWeightKg > suitcase.maxWeightKg + 1e-9,
      overVolume: usedLiters > suitcase.capacityLiters + 1e-9,
    };
  });
}

export interface RoomZoneLoad {
  zone: RoomZone;
  /** Items in unpack order. */
  items: Item[];
  usedLiters: Liters;
  /** null means capacity or assigned volumes are unknown; fit is not established. */
  overVolume: boolean | null;
  categoryMismatches: Item[];
  needsConfirmation: boolean;
}

export function roomZoneLoads(data: PackWiseData): RoomZoneLoad[] {
  const items = indexById(data.items);
  return data.roomZones.map((zone) => {
    const placed = data.unpackingPlan.assignments
      .filter((a) => a.roomZoneId === zone.id)
      .sort((a, b) => a.unpackOrder - b.unpackOrder)
      .map((a) => items.get(a.itemId))
      .filter((item): item is Item => item !== undefined);
    const usedLiters = sum(placed, (i) => i.volumeLiters ?? 0);
    return {
      zone, items: placed, usedLiters,
      overVolume: zone.capacityLiters === null ? null
        : usedLiters > zone.capacityLiters + 1e-9 ? true
        : placed.some((item) => item.volumeLiters === null) ? null : false,
      categoryMismatches: zone.suitableCategories.length ? placed.filter((item) => !zone.suitableCategories.includes(item.category)) : [],
      needsConfirmation: !zone.confirmed,
    };
  });
}

/** Item IDs that have no suitcase assignment in the packing plan. */
export function unpackedItemIds(data: PackWiseData): ItemId[] {
  const assigned = new Set(data.packingPlan.assignments.map((a) => a.itemId));
  return data.items.filter((i) => !assigned.has(i.id)).map((i) => i.id);
}

function sum<T>(values: T[], pick: (value: T) => number): number {
  return values.reduce((total, value) => total + pick(value), 0);
}
