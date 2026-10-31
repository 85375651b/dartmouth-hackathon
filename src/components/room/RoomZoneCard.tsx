"use client";

import { Meter } from "@/components/shared/Meter";
import type { RoomZoneLoad } from "@/lib/loads";
import { ZONE_KINDS } from "@/lib/room-zones";
import { formatDimensions, formatLiters } from "@/lib/units";

export function RoomZoneCard({ load, onEdit, onRemove, onConfirm }: {
  load: RoomZoneLoad;
  onEdit: () => void;
  onRemove: () => void;
  onConfirm: (confirmed: boolean) => void;
}) {
  const { zone, items } = load;
  return (
    <article data-zone-id={zone.id} className="min-w-0 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-brand-600">{ZONE_KINDS[zone.kind]}</p>
      <h3 className="break-words text-base font-semibold">{zone.name}</h3>
      <p className="mt-1 text-sm font-medium">{zone.isDemo && "Sample zone · "}{zone.confirmed ? "User-confirmed available" : "Unconfirmed"}</p>
      <p className="mt-1 text-xs text-stone-600">{zone.dimensionsCm ? `Interior: ${formatDimensions(zone.dimensionsCm)}` : "Dimensions unknown"}</p>
      <p className="mt-1 text-xs text-stone-600">{zone.suitableCategories.length ? `Category preferences: ${zone.suitableCategories.join(", ")}` : "No category preference"}</p>
      <div className="mt-3">
        {items.some((item) => item.volumeLiters === null) && (
          <p className="mb-2 text-xs text-amber-800">Some volumes are unknown. Space used is incomplete; fit has not been established.</p>
        )}
        {zone.capacityLiters === null ? <p className="text-sm">Capacity unknown · {formatLiters(load.usedLiters)} assigned. Fit has not been checked.</p> : <Meter
          label="Estimated space used" value={load.usedLiters} max={zone.capacityLiters}
          valueText={`${formatLiters(load.usedLiters)} / ${formatLiters(zone.capacityLiters)}`} />}
      </div>
      <p className="mt-2 text-xs text-stone-500">Capacity and dimensions are estimates. Confirmation does not prove physical fit or safety.</p>
      {load.overVolume && <p role="alert" className="mt-2 text-sm text-red-700">Assigned items exceed the estimated capacity. Review these assignments.</p>}
      {items.length > 0 && load.needsConfirmation && <p className="mt-2 text-sm text-amber-900">Assignments need review: storage availability is unconfirmed.</p>}
      {load.categoryMismatches.length > 0 && <p className="mt-2 text-sm text-amber-900">Category preferences need review: {load.categoryMismatches.map((item) => item.name).join(", ")}.</p>}
      <p className="mt-3 text-sm font-medium">{items.length} assigned {items.length === 1 ? "item" : "items"}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {items.map((item) => <li key={item.id} data-item-id={item.id} className="break-words">{item.name}</li>)}
        {items.length === 0 && <li className="text-stone-500">Nothing here yet</li>}
      </ul>
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={zone.confirmed} onChange={(event) => onConfirm(event.target.checked)} className="mt-1 shrink-0" />
        I confirm this storage area exists and is available for my items.
      </label>
      <p className="mt-2 text-xs text-stone-500">{zone.confirmed ? "Uncheck to withdraw confirmation." : "Unavailable for future automatic assignment until confirmed. Existing assignments are preserved."}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={onEdit} className="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100">Edit zone<span className="sr-only">: {zone.name}</span></button>
        <button type="button" onClick={onRemove} className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50">Remove zone<span className="sr-only">: {zone.name}</span></button>
      </div>
    </article>
  );
}
