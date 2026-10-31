import type { Item, ItemId } from "./types.ts";

/** Validate both individual measurements and the totals a save would produce. */
export function validateInventoryMeasurements(
  items: Item[],
  editingId: ItemId | null,
  weight: number | null,
  volume: number | null,
): Partial<Record<"weight" | "volume", string>> {
  const errors: Partial<Record<"weight" | "volume", string>> = {};
  if (weight !== null && (!Number.isFinite(weight) || weight < 0)) {
    errors.weight = "Weight must be a valid number of 0 kg or more.";
  }
  if (volume !== null && (!Number.isFinite(volume) || volume <= 0)) {
    errors.volume = "Volume must be a valid number greater than 0 L.";
  }
  const others = items.filter((item) => item.id !== editingId);
  if (!errors.weight && !Number.isFinite(others.reduce((sum, item) => sum + (item.weightKg ?? 0), weight ?? 0))) {
    errors.weight = "This weight would make the inventory total too large. Enter a smaller weight.";
  }
  if (!errors.volume && !Number.isFinite(others.reduce((sum, item) => sum + (item.volumeLiters ?? 0), volume ?? 0))) {
    errors.volume = "This volume would make the inventory total too large. Enter a smaller volume.";
  }
  return errors;
}
