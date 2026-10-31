"use client";

import { Meter } from "@/components/shared/Meter";
import type { SuitcaseLoad } from "@/lib/loads";
import type { Suitcase, SuitcaseId } from "@/lib/types";
import { formatDimensions, formatKg, formatLiters } from "@/lib/units";
import { usePackWise } from "@/state/packwise-store";

interface SuitcaseCardProps {
  load: SuitcaseLoad;
  /** All suitcases on the trip, for the "move to" picker. */
  suitcases: Suitcase[];
}

export function SuitcaseCard({ load, suitcases }: SuitcaseCardProps) {
  const { dispatch } = usePackWise();
  const { suitcase, items } = load;

  return (
    <article className="flex flex-col rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-brand-600">{suitcase.kind}</p>
        <h3 className="text-base font-semibold">{suitcase.name}</h3>
        <p className="text-xs text-stone-500">{formatDimensions(suitcase.dimensionsCm)}</p>
      </header>

      <div className="mt-4 space-y-3">
        {items.some((item) => item.weightKg === null || item.volumeLiters === null) && (
          <p className="text-xs text-amber-800">Some measurements are unknown. Meters show known amounts only.</p>
        )}
        {load.totalWeightKg!==null&&suitcase.maxWeightKg!==null?<Meter
          label="Weight incl. suitcase"
          value={load.totalWeightKg}
          max={suitcase.maxWeightKg}
          valueText={`${formatKg(load.totalWeightKg)} / ${formatKg(suitcase.maxWeightKg)}`}
        />:<p className="text-xs">Loaded weight or limit unknown.</p>}
        {suitcase.capacityLiters!==null?<Meter
          label="Volume (stored estimate)"
          value={load.usedLiters}
          max={suitcase.capacityLiters}
          valueText={`${formatLiters(load.usedLiters)} / ${formatLiters(suitcase.capacityLiters)}`}
        />:<p className="text-xs">Stored capacity unknown.</p>}
      </div>

      <p className="mt-2 text-xs text-stone-500">Volume uses existing stored/demo estimates, not a user-confirmed capacity or airline allowance. It does not guarantee physical fit.</p>

      {(load.overWeight || load.overVolume) && (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Current assignments exceed {load.overWeight && load.overVolume ? "the weight and estimated volume limits" : load.overWeight ? "the weight limit" : "the estimated volume limit"}.
          {" "}Items have not been moved or reoptimized. Adjust your settings or move items before traveling.
        </p>
      )}

      <ol className="mt-4 divide-y divide-stone-100 text-sm">
        {items.map((item) => (
          <li key={item.id} data-item-id={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="block truncate">
                {item.name}
                {item.quantity > 1 && <span className="text-stone-500"> ×{item.quantity}</span>}
              </span>
              <span className="text-xs text-stone-500">
                {formatKg(item.weightKg)} · {formatLiters(item.volumeLiters)}
                {item.carryOnRequired && " · carry-on only"}
              </span>
            </span>
            <label className="text-xs text-stone-600">
              <span className="sr-only">Move {item.name} to</span>
              <select
                value={suitcase.id}
                onChange={(event) =>
                  dispatch({
                    type: "assignItemToSuitcase",
                    itemId: item.id,
                    suitcaseId: event.target.value as SuitcaseId,
                  })
                }
                className="rounded-md border border-stone-300 bg-white px-2 py-1"
              >
                {suitcases.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          </li>
        ))}
        {items.length === 0 && <li className="py-2 text-stone-500">Empty</li>}
      </ol>
    </article>
  );
}
