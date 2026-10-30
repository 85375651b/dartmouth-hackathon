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
  return Math.round(value * 10) / 10;
}

export const formatKg = (kg: Kilograms) => `${round1(kg).toFixed(1)} kg`;
export const formatLiters = (liters: Liters) => `${round1(liters).toFixed(1)} L`;
export const formatCm = (cm: Centimeters) => `${round1(cm)} cm`;
export const formatDimensions = (d: DimensionsCm) =>
  `${round1(d.lengthCm)} × ${round1(d.widthCm)} × ${round1(d.heightCm)} cm`;
