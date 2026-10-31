/**
 * Shared PackWise domain types.
 *
 * Units are fixed across the whole app and encoded in field names:
 *   - mass:      kilograms   (…Kg)
 *   - volume:    liters      (…Liters)
 *   - length:    centimeters (…Cm)
 *
 * Entities reference each other only by stable string IDs. Plans never copy
 * item data; they store `itemId` plus the target suitcase or zone ID, so the
 * same item can be followed from packing to unpacking.
 */

// ---------------------------------------------------------------------------
// Stable IDs
// ---------------------------------------------------------------------------

export type TripId = `trip-${string}`;
export type ItemId = `item-${string}`;
export type SuitcaseId = `case-${string}`;
export type RoomZoneId = `zone-${string}`;
export type PackingPlanId = `pack-${string}`;
export type UnpackingPlanId = `unpack-${string}`;

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/** Mass in kilograms. */
export type Kilograms = number;
/** Volume in liters. */
export type Liters = number;

/** Explicit compressible material: insulation fill, or fabric for an unfilled blanket. */
export type FillMaterial = "down" | "synthetic" | "wool" | "cotton";
export type CompressibleObjectKind = "puffer-jacket" | "pillow" | "sleeping-bag" | "blanket";
export type CompressionReferenceId = `compression-${string}`;

export interface CompressionRequest {
  itemId: ItemId;
  objectKind: CompressibleObjectKind;
  /** Blanket fabric or actual filling; a reference's cover never establishes a match. */
  fillMaterial: FillMaterial;
  /** Whole entry, all units together; never an already-packed Item.volumeLiters. */
  uncompressedVolumeLiters: Liters;
}

export interface CompressionReference {
  id: CompressionReferenceId;
  listingName: string;
  variant: string;
  sourceUrl: string;
  retrievedAt: string;
  fillMaterial: FillMaterial;
  baselineKind: "uncompressed" | "stuff-sack-proxy";
  baselineVolumeLiters: Liters;
  compressedVolumeLiters: Liters;
  /** Omitted on legacy sleeping-bag references. */
  productKind?: "sleeping-bag" | "pillow" | "mattress";
  /** Original retailer text supporting new bedding measurements. */
  measurementEvidence?: { material: string; baseline: string; compressed: string };
}

export type CompressionResult =
  | {
      status: "estimated";
      itemId: ItemId;
      referenceId: CompressionReferenceId;
      ratio: number;
      compressedVolumeLiters: Liters;
      warnings: string[];
    }
  | { status: "unavailable"; itemId: ItemId; reason: string };
/** Length in centimeters. */
export type Centimeters = number;

/** Outer bounding box, in centimeters. */
export interface DimensionsCm {
  lengthCm: Centimeters;
  widthCm: Centimeters;
  heightCm: Centimeters;
}

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

/** User-provided details for one segment; never verified baggage policy. */
export interface FlightDetails {
  detailsKnown: boolean;
  operatingAirline: string;
  flightNumber: string;
  originAirport: string;
  destinationAirport: string;
  cabinClass: string;
  fareBrand: string;
  baggageBenefits: string;
  checkedBagCount: number;
}

export interface Trip {
  id: TripId;
  name: string;
  /** Free-form origin, e.g. "Hanover, NH, USA". */
  origin: string;
  destination: string;
  /** Legacy metadata retained for compatibility; no longer edited in T04. */
  purpose: string;
  flight?: FlightDetails;
  /** ISO 8601 date, e.g. "2027-01-08"; blank when unknown. */
  departureDate: string;
  durationDays: number;
  itemIds: ItemId[];
  suitcaseIds: SuitcaseId[];
  roomZoneIds: RoomZoneId[];
  /** True for bundled sample content; never true for user-entered trips. */
  isDemo: boolean;
}

export type ItemCategory =
  | "clothing"
  | "shoes"
  | "toiletries"
  | "electronics"
  | "documents"
  | "linens"
  | "kitchen"
  | "study"
  | "personal"
  | "other";

export type Cleanliness = "clean" | "dirty" | "protected";

/** How an item tolerates being packed. */
export type Fragility = "sturdy" | "normal" | "fragile";

export interface Item {
  id: ItemId;
  name: string;
  category: ItemCategory;
  /** Weight of all units together; null until confirmed (zero is valid). */
  weightKg: Kilograms | null;
  /** Packed volume of all units together; null until confirmed. */
  volumeLiters: Liters | null;
  /** Packed bounding box of the whole entry; null until measured. */
  dimensionsCm: DimensionsCm | null;
  quantity: number;
  fragility: Fragility;
  /** Should travel in the carry-on (documents, valuables, batteries). */
  carryOnRequired: boolean;
  /** Absent on legacy demo entries; treated as clean by the editor. */
  cleanliness?: Cleanliness;
  notes?: string;
}

export type SuitcaseKind = "checked" | "carry-on";

export interface Suitcase {
  id: SuitcaseId;
  name: string;
  kind: SuitcaseKind;
  /** User's approximate weight of the empty suitcase. */
  emptyWeightKg: Kilograms;
  /** Manually entered total weight limit including contents; not verified policy. */
  maxWeightKg: Kilograms;
  /** Stored estimate of usable interior volume; not an airline allowance. */
  capacityLiters: Liters;
  dimensionsCm: DimensionsCm;
  /** Explicit user-reviewed usable interior; separate from the visible exterior. */
  interiorFootprintCm?: { lengthCm: number; widthCm: number };
}

export type RoomZoneKind =
  | "closet"
  | "dresser"
  | "desk"
  | "shelf"
  | "drawer"
  | "other"
  | "under-bed"
  | "bathroom";

export interface RoomZone {
  id: RoomZoneId;
  name: string;
  kind: RoomZoneKind;
  /** User estimate of free storage; null means unknown, never unlimited. */
  capacityLiters: Liters | null;
  /** Interior dimensions; null means unknown. */
  dimensionsCm: DimensionsCm | null;
  /** Explicitly confirmed available by the current user, independent of fit. */
  confirmed: boolean;
  /** Retain sample provenance even after confirmation. */
  isDemo: boolean;
  /** Category preferences; an empty list means no preference. */
  suitableCategories: ItemCategory[];
}

// ---------------------------------------------------------------------------
// Plans (assignments by ID)
// ---------------------------------------------------------------------------

/** Places one item in one suitcase. */
export interface PackingAssignment {
  itemId: ItemId;
  suitcaseId: SuitcaseId;
  /** 1 = pack first (bottom), higher numbers go in later (top). */
  packOrder: number;
}

export interface PackingPlan {
  id: PackingPlanId;
  tripId: TripId;
  assignments: PackingAssignment[];
  /** Items intentionally left out of every suitcase. */
  unassignedItemIds: ItemId[];
  areaPlans?: import("./photo-packing/types.ts").AreaPlan[];
}

/** Places one item in one room storage zone. */
export interface UnpackingAssignment {
  itemId: ItemId;
  roomZoneId: RoomZoneId;
  /** 1 = unpack first after arrival. */
  unpackOrder: number;
}

export interface UnpackingPlan {
  id: UnpackingPlanId;
  tripId: TripId;
  /** The packing plan this unpacking plan follows. */
  packingPlanId: PackingPlanId;
  assignments: UnpackingAssignment[];
  unassignedItemIds: ItemId[];
}

// ---------------------------------------------------------------------------
// Aggregate state
// ---------------------------------------------------------------------------

/** Everything the app holds in browser memory for one trip. */
export interface PackWiseData {
  trip: Trip;
  items: Item[];
  suitcases: Suitcase[];
  roomZones: RoomZone[];
  packingPlan: PackingPlan;
  unpackingPlan: UnpackingPlan;
}
