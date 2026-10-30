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
  | "personal";

/** How an item tolerates being packed. */
export type Fragility = "sturdy" | "normal" | "fragile";

export interface Item {
  id: ItemId;
  name: string;
  category: ItemCategory;
  /** Weight of all units together. */
  weightKg: Kilograms;
  /** Packed volume of all units together. */
  volumeLiters: Liters;
  /** Packed bounding box of the whole entry (all units bundled together). */
  dimensionsCm: DimensionsCm;
  quantity: number;
  fragility: Fragility;
  /** Should travel in the carry-on (documents, valuables, batteries). */
  carryOnRequired: boolean;
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
}

export type RoomZoneKind =
  | "closet"
  | "dresser"
  | "desk"
  | "shelf"
  | "under-bed"
  | "bathroom";

export interface RoomZone {
  id: RoomZoneId;
  name: string;
  kind: RoomZoneKind;
  /** Usable storage volume. */
  capacityLiters: Liters;
  dimensionsCm: DimensionsCm;
  /** Item categories that naturally belong here. */
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
