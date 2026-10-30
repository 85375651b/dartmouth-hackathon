"use client";

import { usePackWise } from "@/state/packwise-store";
import { round1 } from "@/lib/units";

export function TripSummary() {
  const { data } = usePackWise();
  const { trip, items } = data;
  const totalKg = round1(items.reduce((sum, item) => sum + item.weightKg, 0));
  const totalLiters = round1(items.reduce((sum, item) => sum + item.volumeLiters, 0));
  const departure = new Date(`${trip.departureDate}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

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
    </section>
  );
}
