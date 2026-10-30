import type { PackWiseData, SuitcaseId } from "./types.ts";

export interface TripSettingsDraft {
  destination: string;
  durationDays: string;
  purpose: string;
  suitcases: {
    id: SuitcaseId;
    capacityLiters: string;
    maxWeightKg: string;
    emptyWeightKg: string;
  }[];
}

export function createTripSettingsDraft(data: PackWiseData): TripSettingsDraft {
  return {
    destination: data.trip.destination,
    durationDays: String(data.trip.durationDays),
    purpose: data.trip.purpose,
    suitcases: data.suitcases.map((bag) => ({
      id: bag.id,
      capacityLiters: String(bag.capacityLiters),
      maxWeightKg: String(bag.maxWeightKg),
      emptyWeightKg: String(bag.emptyWeightKg),
    })),
  };
}

export function validateTripSettings(draft: TripSettingsDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.destination.trim()) errors.destination = "Enter a destination.";
  if (!draft.purpose.trim()) errors.purpose = "Enter a travel purpose.";
  const days = Number(draft.durationDays);
  if (!draft.durationDays.trim() || !Number.isSafeInteger(days) || days <= 0) {
    errors.durationDays = "Enter a positive whole number of days.";
  }
  for (const bag of draft.suitcases) {
    for (const field of ["capacityLiters", "maxWeightKg", "emptyWeightKg"] as const) {
      const value = Number(bag[field]);
      const zeroAllowed = field === "emptyWeightKg";
      if (!bag[field].trim() || !Number.isFinite(value) || (zeroAllowed ? value < 0 : value <= 0)) {
        errors[`${bag.id}-${field}`] = `Enter a ${zeroAllowed ? "nonnegative" : "positive"} finite number in ${field === "capacityLiters" ? "liters" : "kilograms"}.`;
      }
    }
    if (!errors[`${bag.id}-emptyWeightKg`] && !errors[`${bag.id}-maxWeightKg`]
        && Number(bag.emptyWeightKg) > Number(bag.maxWeightKg)) {
      errors[`${bag.id}-emptyWeightKg`] = "Empty suitcase weight cannot exceed maximum total weight.";
    }
  }
  return errors;
}

/** Update only editable fields, atomically; retain inventory, IDs and assignments. */
export function applyTripSettings(data: PackWiseData, draft: TripSettingsDraft): PackWiseData {
  if (Object.keys(validateTripSettings(draft)).length) return data;
  const edits = new Map(draft.suitcases.map((bag) => [bag.id, bag]));
  if (edits.size !== data.suitcases.length || draft.suitcases.length !== edits.size
      || data.suitcases.some((bag) => !edits.has(bag.id))) return data;
  return {
    ...data,
    trip: {
      ...data.trip,
      destination: draft.destination.trim(),
      purpose: draft.purpose.trim(),
      durationDays: Number(draft.durationDays),
    },
    suitcases: data.suitcases.map((bag) => {
      const edit = edits.get(bag.id)!;
      return { ...bag, capacityLiters: Number(edit.capacityLiters),
        maxWeightKg: Number(edit.maxWeightKg), emptyWeightKg: Number(edit.emptyWeightKg) };
    }),
  };
}
