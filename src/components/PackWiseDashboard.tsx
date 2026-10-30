"use client";

import { RoomZoneCard } from "@/components/room/RoomZoneCard";
import { SuitcaseCard } from "@/components/packing/SuitcaseCard";
import { DemoBanner } from "@/components/shared/DemoBanner";
import { TripSummary } from "@/components/trip/TripSummary";
import { TripSettings } from "@/components/trip/TripSettings";
import { roomZoneLoads, suitcaseLoads } from "@/lib/loads";
import { usePackWise } from "@/state/packwise-store";

export function PackWiseDashboard() {
  const { data } = usePackWise();
  const packed = suitcaseLoads(data);
  const placed = roomZoneLoads(data);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <header>
        <h1 className="text-4xl font-bold tracking-tight text-brand-700 sm:text-5xl">PackWise</h1>
        <p className="mt-2 text-lg text-stone-600 sm:text-xl">From packed to placed.</p>
      </header>

      <DemoBanner />
      <TripSummary />
      <TripSettings />

      <section aria-labelledby="packed-heading">
        <h2 id="packed-heading" className="mb-3 text-xl font-semibold">
          Packed
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {packed.map((load) => (
            <SuitcaseCard key={load.suitcase.id} load={load} suitcases={data.suitcases} />
          ))}
        </div>
      </section>

      <section aria-labelledby="placed-heading">
        <h2 id="placed-heading" className="mb-3 text-xl font-semibold">
          Placed
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {placed.map((load) => (
            <RoomZoneCard key={load.zone.id} load={load} />
          ))}
        </div>
      </section>

      <footer className="border-t border-stone-200 pt-4 text-xs text-stone-500">
        All measurements use kilograms (kg), liters (L), and centimeters (cm).
      </footer>
    </div>
  );
}
