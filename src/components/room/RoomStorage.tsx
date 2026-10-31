"use client";

import { useEffect, useRef, useState } from "react";
import { RoomZoneCard } from "./RoomZoneCard";
import { RoomZoneForm } from "./RoomZoneForm";
import { roomZoneLoads } from "@/lib/loads";
import { newRoomZoneId } from "@/lib/room-zones";
import type { RoomZoneId } from "@/lib/types";
import { usePackWise } from "@/state/packwise-store";

/** Reset unmounts open drafts and removal confirmations, even with identical demo data. */
export function RoomStorage() {
  const { resetVersion } = usePackWise();
  return <RoomStorageContent key={resetVersion} />;
}

function RoomStorageContent() {
  const { data, dispatch } = usePackWise();
  const [editing, setEditing] = useState<RoomZoneId | "new" | null>(null);
  const [removing, setRemoving] = useState<RoomZoneId | null>(null);
  const [message, setMessage] = useState("");
  const addButton = useRef<HTMLButtonElement>(null);
  const removeHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (removing) removeHeading.current?.focus(); }, [removing]);
  const loads = roomZoneLoads(data);
  const selected = data.roomZones.find((zone) => zone.id === editing);
  const removal = loads.find((load) => load.zone.id === removing);
  const unassigned = data.items.filter((item) => data.unpackingPlan.unassignedItemIds.includes(item.id));

  function restoreFocus() { requestAnimationFrame(() => addButton.current?.focus()); }

  return <section aria-labelledby="placed-heading" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 id="placed-heading" className="text-xl font-semibold">Edit room storage</h2>
        <p className="mt-1 text-sm text-stone-600">{data.roomZones.filter((zone) => zone.confirmed).length} of {data.roomZones.length} zones confirmed available</p>
      </div>
      <button ref={addButton} type="button" disabled={editing !== null || removing !== null} onClick={() => { setEditing("new"); setMessage(""); }} className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50">Add storage zone</button>
    </div>
    <p className="text-sm text-stone-600">Create the storage you can use at your destination. Sample zones are unconfirmed until you explicitly verify availability. Save measurements only if known; they are not inferred from a photo. Changes reset on reload.</p>
    <p role="status" className="text-sm text-brand-700">{message}</p>
    {editing !== null && <RoomZoneForm key={editing} zone={selected} onSave={(draft) => {
      const id = editing === "new" ? newRoomZoneId() : editing;
      dispatch({ type: "saveRoomZone", id, draft, creating: editing === "new" });
      setEditing(null);
      setMessage("Zone saved. Check its availability confirmation below; changes to type, measurements, or categories require reconfirmation. Existing items have not been moved.");
      restoreFocus();
    }} onCancel={() => { setEditing(null); setMessage("Unsaved zone edits discarded."); restoreFocus(); }} />}
    {removal && <div className="rounded-xl border border-red-300 bg-red-50 p-5" role="region" aria-labelledby="remove-zone-heading">
      <h3 ref={removeHeading} tabIndex={-1} id="remove-zone-heading" className="font-semibold">Remove {removal.zone.name}?</h3>
      <p className="mt-2 text-sm">This removes the zone and affects {removal.items.length} unpacking assignments. Those items will appear under Unassigned room items. Inventory and suitcase assignments stay intact.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" onClick={() => { dispatch({ type: "removeRoomZone", id: removal.zone.id }); setRemoving(null); setMessage(`Removed ${removal.zone.name}. ${removal.items.length} items returned to the unassigned room list.`); restoreFocus(); }} className="rounded-md bg-red-700 px-4 py-2 text-sm text-white">Confirm removal</button>
        <button type="button" onClick={() => { setRemoving(null); setMessage("Removal canceled. Nothing changed."); restoreFocus(); }} className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm">Keep zone</button>
      </div>
    </div>}
    {data.roomZones.length === 0 && <p className="rounded-lg border border-dashed border-stone-300 p-5 text-sm">No storage zones yet. Choose Add storage zone to describe a desk, wardrobe, shelf, drawer, or another storage area.</p>}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {loads.map((load) => <RoomZoneCard key={load.zone.id} load={load}
        onEdit={() => { if (editing !== null || removing !== null) { setMessage("Save or cancel the open draft or removal first."); return; } setEditing(load.zone.id); setMessage(""); }}
        onRemove={() => { if (editing !== null || removing !== null) { setMessage("Save or cancel the open draft or removal first."); return; } setRemoving(load.zone.id); setMessage(""); }}
        onConfirm={(confirmed) => { if (editing !== null || removing !== null) { setMessage("Save or cancel the open draft or removal before changing confirmation."); return; } dispatch({ type: "confirmRoomZone", id: load.zone.id, confirmed }); setMessage(confirmed ? `${load.zone.name} confirmed available. Fit and safety still need checking.` : `Confirmation withdrawn for ${load.zone.name}. Existing assignments need review.`); }} />)}
    </div>
    <section aria-labelledby="unassigned-room-heading" className="rounded-xl border border-stone-200 bg-white p-4">
      <h3 id="unassigned-room-heading" className="font-semibold">Unassigned room items ({unassigned.length})</h3>
      <p className="mt-1 text-sm text-stone-600">These items remain in your inventory and packing plan, but have no room storage assignment. This editor does not generate new assignments.</p>
      <ul className="mt-2 space-y-1 text-sm">{unassigned.map((item) => <li key={item.id}>{item.name}</li>)}</ul>
      {unassigned.length === 0 && <p className="mt-2 text-sm text-stone-500">No unassigned room items.</p>}
    </section>
  </section>;
}
