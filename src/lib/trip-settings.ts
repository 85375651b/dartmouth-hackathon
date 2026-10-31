import type { FlightDetails, PackWiseData, SuitcaseId } from "./types.ts";

export interface TripSettingsDraft {
  destination: string;
  durationDays: string;
  departureDate: string;
  flight: Omit<FlightDetails, "checkedBagCount"> & { checkedBagCount: string };
  suitcases: {
    id: SuitcaseId;
    maxWeightKg: string;
    emptyWeightKg: string;
  }[];
}

export function createTripSettingsDraft(data: PackWiseData): TripSettingsDraft {
  return {
    destination: data.trip.destination,
    durationDays: String(data.trip.durationDays ?? ""),
    departureDate: data.trip.departureDate,
    flight: {
      detailsKnown: data.trip.flight?.detailsKnown ?? false,
      operatingAirline: data.trip.flight?.operatingAirline ?? "",
      flightNumber: data.trip.flight?.flightNumber ?? "",
      originAirport: data.trip.flight?.originAirport ?? "",
      destinationAirport: data.trip.flight?.destinationAirport ?? "",
      cabinClass: data.trip.flight?.cabinClass ?? "Unknown",
      fareBrand: data.trip.flight?.fareBrand ?? "",
      baggageBenefits: data.trip.flight?.baggageBenefits ?? "",
      checkedBagCount: String(data.trip.flight?.checkedBagCount ?? data.suitcases.filter((bag) => bag.kind === "checked").length),
    },
    suitcases: data.suitcases.map((bag) => ({
      id: bag.id,
      maxWeightKg: String(bag.maxWeightKg ?? ""),
      emptyWeightKg: String(bag.emptyWeightKg ?? ""),
    })),
  };
}

export function validateTripSettings(draft: TripSettingsDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.destination.trim()) errors.destination = "Enter a destination.";
  if (draft.departureDate && !isValidDepartureDate(draft.departureDate)) {
    errors.departureDate = "Enter a valid departure date.";
  }
  const count = Number(draft.flight.checkedBagCount);
  if (!draft.flight.checkedBagCount.trim() || !Number.isSafeInteger(count) || count < 0) {
    errors.checkedBagCount = "Enter a nonnegative whole number of checked bags.";
  }
  if (draft.flight.detailsKnown) {
    const flightNumber = draft.flight.flightNumber.trim();
    if (flightNumber && !/^(?=.*[a-z])(?=.*\d)[a-z0-9][a-z0-9 -]*$/i.test(flightNumber)) {
      errors.flightNumber = "Include the airline prefix and flight number, for example BA 123 or U2-456.";
    }
    if (!CABIN_CLASSES.includes(draft.flight.cabinClass)) errors.cabinClass = "Choose a cabin class or Unknown.";
    const origin = draft.flight.originAirport.trim();
    const destination = draft.flight.destinationAirport.trim();
    if (origin && destination && origin.toLowerCase() === destination.toLowerCase()) {
      errors.destinationAirport = "Departure and arrival airports must be different.";
    }
  }
  const days = Number(draft.durationDays);
  if (!draft.durationDays.trim() || !Number.isSafeInteger(days) || days <= 0) {
    errors.durationDays = "Enter a positive whole number of days.";
  }
  for (const bag of draft.suitcases) {
    for (const field of ["maxWeightKg", "emptyWeightKg"] as const) {
      const value = Number(bag[field]);
      const zeroAllowed = field === "emptyWeightKg";
      if (!bag[field].trim() || !Number.isFinite(value) || (zeroAllowed ? value < 0 : value <= 0)) {
        errors[`${bag.id}-${field}`] = `Enter a ${zeroAllowed ? "nonnegative" : "positive"} finite number in kilograms.`;
      }
    }
    if (!errors[`${bag.id}-emptyWeightKg`] && !errors[`${bag.id}-maxWeightKg`]
        && Number(bag.emptyWeightKg) > Number(bag.maxWeightKg)) {
      errors[`${bag.id}-emptyWeightKg`] = "Approximate empty suitcase weight cannot exceed maximum total weight.";
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
      departureDate: draft.departureDate,
      flight: {
        ...draft.flight,
        operatingAirline: draft.flight.operatingAirline.trim(),
        flightNumber: draft.flight.flightNumber.trim(),
        originAirport: draft.flight.originAirport.trim(),
        destinationAirport: draft.flight.destinationAirport.trim(),
        fareBrand: draft.flight.fareBrand.trim(),
        baggageBenefits: draft.flight.baggageBenefits.trim(),
        checkedBagCount: Number(draft.flight.checkedBagCount),
      },
      durationDays: Number(draft.durationDays),
    },
    suitcases: data.suitcases.map((bag) => {
      const edit = edits.get(bag.id)!;
      return { ...bag,
        maxWeightKg: Number(edit.maxWeightKg), emptyWeightKg: Number(edit.emptyWeightKg) };
    }),
  };
}

export const CABIN_CLASSES = ["Unknown", "Economy", "Premium economy", "Business", "First", "Other"];

export function isValidDepartureDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Missing details are guidance, not blockers for manual packing. */
export function missingFlightDetails(draft: TripSettingsDraft): string[] {
  if (!draft.flight.detailsKnown) return ["flight details"];
  return [
    !draft.flight.operatingAirline.trim() && "operating airline",
    !draft.flight.flightNumber.trim() && "flight number",
    !draft.departureDate && "departure date",
    !draft.flight.originAirport.trim() && "origin airport",
    !draft.flight.destinationAirport.trim() && "destination airport",
    draft.flight.cabinClass === "Unknown" && "cabin class",
    !draft.flight.fareBrand.trim() && "fare brand or ticket type",
  ].filter((entry): entry is string => Boolean(entry));
}
