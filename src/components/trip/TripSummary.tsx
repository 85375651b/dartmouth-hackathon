"use client";

import { usePackWise } from "@/state/packwise-store";
import { round1 } from "@/lib/units";

export function TripSummary() {
  const { data } = usePackWise();
  const { trip, items } = data;
  const totalKg = round1(items.reduce((sum, item) => sum + item.weightKg, 0));
  const totalLiters = round1(items.reduce((sum, item) => sum + item.volumeLiters, 0));
  const departure = trip.departureDate ? new Date(`${trip.departureDate}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }) : "Date unknown";

  const stats = [
    { label: "Route", value: `${trip.origin} → ${trip.destination}` },
    { label: "Departs", value: `${departure} · ${trip.durationDays} days` },
    { label: "Items", value: `${items.length} entries · ${totalKg} kg · ${totalLiters} L` },
  ];

  return (
    <section aria-labelledby="trip-heading" className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 id="trip-heading" className="text-lg font-semibold">
        {trip.name}
      </h2>
      <dl className="mt-3 grid gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{stat.label}</dt>
            <dd className="mt-0.5 text-sm">{stat.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 border-t border-stone-100 pt-3 text-sm text-stone-600">
        <h3 className="font-medium">Flight and baggage details · not verified</h3>
        {trip.flight?.detailsKnown ? <>
          <p>{trip.flight.operatingAirline || "Airline unknown"} · {trip.flight.flightNumber || "Flight number unknown"}</p>
          <p>{trip.flight.originAirport || "Origin airport unknown"} → {trip.flight.destinationAirport || "Destination airport unknown"}</p>
          <p>Cabin: {trip.flight.cabinClass} · Fare: {trip.flight.fareBrand || "Unknown"}</p>
          <p>Benefits: {trip.flight.baggageBenefits || "None specified"}</p>
        </> : <p>Flight details not available yet. Manual packing is available.</p>}
        <p>Expected checked bags: {trip.flight?.checkedBagCount ?? data.suitcases.filter((bag) => bag.kind === "checked").length}</p>
        {trip.flight && trip.flight.checkedBagCount !== data.suitcases.filter((bag) => bag.kind === "checked").length && <p className="text-amber-900">Expected checked-bag count differs from the current plan. No suitcases were added or removed.</p>}
      </div>
    </section>
  );
}
