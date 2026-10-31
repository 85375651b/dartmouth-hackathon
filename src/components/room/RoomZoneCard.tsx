"use client";

import { Meter } from "@/components/shared/Meter";
import type { RoomZoneLoad } from "@/lib/loads";
import { formatLiters } from "@/lib/units";

export function RoomZoneCard({ load }: { load: RoomZoneLoad }) {
  const { zone, items } = load;
  return (
    <article className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-brand-600">{zone.kind}</p>
      <h3 className="text-sm font-semibold">{zone.name}</h3>
      <div className="mt-3">
        {items.some((item) => item.volumeLiters === null) && (
          <p className="mb-2 text-xs text-amber-800">Some volumes are unknown. Space used is incomplete.</p>
        )}
        <Meter
          label="Space used"
          value={load.usedLiters}
          max={zone.capacityLiters}
          valueText={`${formatLiters(load.usedLiters)} / ${formatLiters(zone.capacityLiters)}`}
        />
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {items.map((item) => (
          <li key={item.id} data-item-id={item.id} className="truncate">
            {item.name}
          </li>
        ))}
        {items.length === 0 && <li className="text-stone-500">Nothing here yet</li>}
      </ul>
    </article>
  );
}
