import type { ItemCategory, PackWiseData, RoomZone, RoomZoneId, RoomZoneKind } from "./types.ts";

export const ZONE_KINDS: Record<RoomZoneKind, string> = {
  closet: "Wardrobe / closet", dresser: "Dresser", desk: "Desk", shelf: "Shelf",
  drawer: "Drawer", "under-bed": "Under-bed storage", bathroom: "Bathroom storage", other: "Other storage",
};
export const ITEM_CATEGORIES: ItemCategory[] = ["clothing", "shoes", "toiletries", "electronics", "documents", "linens", "kitchen", "study", "personal", "other"];

export function isRoomZoneKind(value: string): value is RoomZoneKind {
  return Object.hasOwn(ZONE_KINDS, value);
}

export interface RoomZoneDraft {
  name: string;
  kind: RoomZoneKind;
  capacityLiters: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  suitableCategories: ItemCategory[];
}

export function roomZoneDraft(zone?: RoomZone): RoomZoneDraft {
  return {
    name: zone?.name ?? "", kind: zone?.kind ?? "desk",
    capacityLiters: zone?.capacityLiters == null ? "" : String(zone.capacityLiters),
    lengthCm: zone?.dimensionsCm ? String(zone.dimensionsCm.lengthCm) : "",
    widthCm: zone?.dimensionsCm ? String(zone.dimensionsCm.widthCm) : "",
    heightCm: zone?.dimensionsCm ? String(zone.dimensionsCm.heightCm) : "",
    suitableCategories: [...(zone?.suitableCategories ?? [])],
  };
}

export function validateRoomZoneDraft(draft: RoomZoneDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.name.trim()) errors.name = "Enter a storage-zone name.";
  if (!isRoomZoneKind(draft.kind)) errors.kind = "Choose a supported storage type.";
  for (const field of ["capacityLiters", "lengthCm", "widthCm", "heightCm"] as const) {
    if (draft[field].trim() && (!Number.isFinite(Number(draft[field])) || Number(draft[field]) <= 0)) {
      errors[field] = "Enter a positive finite number, or leave blank if unknown.";
    }
  }
  const dimensions = ["lengthCm", "widthCm", "heightCm"] as const;
  if (dimensions.some((field) => draft[field].trim()) && dimensions.some((field) => !draft[field].trim())) {
    for (const field of dimensions) if (!draft[field].trim()) errors[field] = "Enter all three interior dimensions, or leave all three blank.";
  }
  if (draft.suitableCategories.some((category) => !ITEM_CATEGORIES.includes(category))) errors.suitableCategories = "Choose supported item categories.";
  return errors;
}

/** IDs are generated on user actions, never during server rendering. */
export function newRoomZoneId(): RoomZoneId {
  return `zone-${crypto.randomUUID()}`;
}

export function saveRoomZone(data: PackWiseData, draft: RoomZoneDraft, id: RoomZoneId, creating: boolean): PackWiseData {
  if (Object.keys(validateRoomZoneDraft(draft)).length) return data;
  const previous = data.roomZones.find((zone) => zone.id === id);
  if (creating ? Boolean(previous) : !previous) return data;
  const zone: RoomZone = {
    ...previous,
    id, name: draft.name.trim(), kind: draft.kind,
    capacityLiters: draft.capacityLiters.trim() ? Number(draft.capacityLiters) : null,
    dimensionsCm: draft.lengthCm.trim() ? {
      lengthCm: Number(draft.lengthCm), widthCm: Number(draft.widthCm), heightCm: Number(draft.heightCm),
    } : null,
    suitableCategories: [...new Set(draft.suitableCategories)],
    confirmed: false, isDemo: previous?.isDemo ?? false,
  };
  // Compare semantic values; reordering category checkboxes is not a change.
  const unchanged = previous && previous.kind === zone.kind
    && previous.capacityLiters === zone.capacityLiters
    && previous.dimensionsCm?.lengthCm === zone.dimensionsCm?.lengthCm
    && previous.dimensionsCm?.widthCm === zone.dimensionsCm?.widthCm
    && previous.dimensionsCm?.heightCm === zone.dimensionsCm?.heightCm
    && [...previous.suitableCategories].sort().join(",") === [...zone.suitableCategories].sort().join(",");
  zone.confirmed = Boolean(previous?.confirmed && unchanged);
  const roomZones = creating ? [...data.roomZones, zone] : data.roomZones.map((entry) => entry.id === id ? zone : entry);
  return { ...data, roomZones, trip: { ...data.trip, roomZoneIds: roomZones.map((entry) => entry.id) } };
}

export function setRoomZoneConfirmation(data: PackWiseData, id: RoomZoneId, confirmed: boolean): PackWiseData {
  if (!data.roomZones.some((zone) => zone.id === id)) return data;
  return { ...data, roomZones: data.roomZones.map((zone) => zone.id === id ? { ...zone, confirmed } : zone) };
}

export function removeRoomZone(data: PackWiseData, id: RoomZoneId): PackWiseData {
  if (!data.roomZones.some((zone) => zone.id === id)) return data;
  const roomZones = data.roomZones.filter((zone) => zone.id !== id);
  const assignments = data.unpackingPlan.assignments.filter((assignment) => assignment.roomZoneId !== id);
  const stillAssigned = new Set(assignments.map((assignment) => assignment.itemId));
  const affected = data.unpackingPlan.assignments.filter((assignment) => assignment.roomZoneId === id).map((assignment) => assignment.itemId);
  return {
    ...data, roomZones, trip: { ...data.trip, roomZoneIds: roomZones.map((zone) => zone.id) },
    unpackingPlan: {
      ...data.unpackingPlan, assignments,
      unassignedItemIds: [...new Set([...data.unpackingPlan.unassignedItemIds, ...affected])].filter((itemId) => !stillAssigned.has(itemId)),
    },
  };
}
