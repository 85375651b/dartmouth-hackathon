import type { Centimeters, DimensionsCm, Kilograms, Liters } from "./types.ts";

/** 1 liter = 1,000 cubic centimeters. */
export const CUBIC_CM_PER_LITER = 1000;

/** Bounding-box volume of a set of dimensions, in liters. */
export function boxVolumeLiters({ lengthCm, widthCm, heightCm }: DimensionsCm): Liters {
  return (lengthCm * widthCm * heightCm) / CUBIC_CM_PER_LITER;
}

/** True if `inner` fits inside `outer` in some axis-aligned orientation. */
export function fitsWithin(inner: DimensionsCm, outer: DimensionsCm): boolean {
  const sort = (d: DimensionsCm) =>
    [d.lengthCm, d.widthCm, d.heightCm].sort((a, b) => b - a);
  const a = sort(inner);
  const b = sort(outer);
  return a.every((side, i) => side <= b[i]);
}

/** Rounds to one decimal place to avoid floating-point noise in sums. */
export function round1(value: number): number {
  // Multiplying a large finite value by ten can overflow. At this magnitude
  // a JavaScript number already has less than one decimal place of precision.
  if (Math.abs(value) >= 1e15) return value;
  return Math.round(value * 10) / 10;
}

/** Keep positive measurements visibly distinct from zero, without giant strings. */
export function formatMeasurementNumber(value: number, minimumFractionDigits = 0): string {
  if (!Number.isFinite(value)) return "Out of range";
  const magnitude = Math.abs(value);
  return new Intl.NumberFormat("en-US", {
    notation: magnitude !== 0 && (magnitude < 1e-6 || magnitude >= 1e9) ? "scientific" : "standard",
    minimumFractionDigits,
    maximumFractionDigits: 6,
  }).format(value);
}

export const formatKg = (kg: Kilograms | null) => kg === null ? "Weight unknown" : `${formatMeasurementNumber(kg, 1)} kg`;
export const formatLiters = (liters: Liters | null) => liters === null ? "Volume unknown" : `${formatMeasurementNumber(liters, 1)} L`;
export const formatCm = (cm: Centimeters) => `${round1(cm)} cm`;
export const formatDimensions = (d: DimensionsCm | null) => d === null ? "Exterior dimensions unknown" :
  `${round1(d.lengthCm)} × ${round1(d.widthCm)} × ${round1(d.heightCm)} cm`;
