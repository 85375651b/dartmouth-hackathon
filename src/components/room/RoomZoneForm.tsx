"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ITEM_CATEGORIES, ZONE_KINDS, isRoomZoneKind, roomZoneDraft, validateRoomZoneDraft, type RoomZoneDraft } from "@/lib/room-zones";
import type { RoomZone } from "@/lib/types";

export function RoomZoneForm({ zone, onSave, onCancel }: {
  zone?: RoomZone;
  onSave: (draft: RoomZoneDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => roomZoneDraft(zone));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { form.current?.querySelector<HTMLInputElement>("input")?.focus(); }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateRoomZoneDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    onSave(draft);
  }

  function input(key: "name" | "capacityLiters" | "lengthCm" | "widthCm" | "heightCm", label: string) {
    const id = `zone-${key}`;
    return <div className="min-w-0">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <input id={id} type={key === "name" ? "text" : "number"} step={key === "name" ? undefined : "any"}
        required={key === "name"} value={draft[key]}
        aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `${id}-error` : undefined}
        onChange={(event) => { setDraft({ ...draft, [key]: event.target.value }); setErrors((old) => { const next = { ...old }; delete next[key]; return next; }); }}
        className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base aria-invalid:border-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600" />
      {errors[key] && <p id={`${id}-error`} className="mt-1 text-sm text-red-700">{errors[key]}</p>}
    </div>;
  }

  return <form ref={form} noValidate onSubmit={submit} aria-labelledby="zone-form-heading" className="space-y-4 rounded-xl border border-brand-500 bg-brand-50 p-5">
    <h3 id="zone-form-heading" className="text-lg font-semibold">{zone ? `Edit ${zone.name}` : "New storage zone"}</h3>
    <p className="text-sm text-stone-600">Save the zone first, then explicitly confirm its availability on its card. Changing type, measurements, or categories requires reconfirmation. A name-only edit keeps confirmation.</p>
    <div className="grid gap-4 sm:grid-cols-2">
      {input("name", "Zone name")}
      <div>
        <label htmlFor="zone-kind" className="block text-sm font-medium">Storage type</label>
        <select id="zone-kind" value={draft.kind} aria-invalid={Boolean(errors.kind)} aria-describedby={errors.kind ? "zone-kind-error" : undefined}
          onChange={(event) => { const kind = event.target.value; if (isRoomZoneKind(kind)) setDraft({ ...draft, kind }); }}
          className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2">
          {Object.entries(ZONE_KINDS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
        </select>
        {errors.kind && <p id="zone-kind-error" className="text-sm text-red-700">{errors.kind}</p>}
      </div>
    </div>
    {input("capacityLiters", "Estimated usable capacity (L, optional)")}
    <fieldset aria-describedby="zone-measurement-help" className="rounded-lg border border-stone-300 p-4">
      <legend className="px-1 text-sm font-medium">Interior dimensions (cm, optional)</legend>
      <p id="zone-measurement-help" className="mb-3 text-sm text-stone-600">Enter all three or leave all blank if unknown. These are your estimates, not photo measurements. Dimensions do not determine free capacity; volume alone does not guarantee fit.</p>
      <div className="grid gap-4 sm:grid-cols-3">{input("lengthCm", "Interior length (cm)")}{input("widthCm", "Interior width (cm)")}{input("heightCm", "Interior height (cm)")}</div>
    </fieldset>
    <fieldset aria-describedby="zone-category-help" className="rounded-lg border border-stone-300 p-4">
      <legend className="px-1 text-sm font-medium">Suitable item categories</legend>
      <p id="zone-category-help" className="mb-3 text-sm text-stone-600">Preferences only. Leave all unchecked for no category preference.</p>
      <div className="grid gap-2 sm:grid-cols-3">{ITEM_CATEGORIES.map((category) => <label key={category} className="flex items-center gap-2 text-sm capitalize">
        <input type="checkbox" checked={draft.suitableCategories.includes(category)} onChange={(event) => setDraft({ ...draft, suitableCategories: event.target.checked ? [...draft.suitableCategories, category] : draft.suitableCategories.filter((value) => value !== category) })} />{category}
      </label>)}</div>
      <button type="button" className="mt-3 text-sm underline" onClick={() => setDraft({ ...draft, suitableCategories: [] })}>Clear category preferences</button>
      {errors.suitableCategories && <p role="alert" className="text-sm text-red-700">{errors.suitableCategories}</p>}
    </fieldset>
    {Object.keys(errors).length > 0 && <p role="alert" className="text-sm text-red-700">Zone not saved. Correct the highlighted fields; your draft is preserved.</p>}
    <div className="flex flex-wrap gap-3">
      <button type="submit" className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600">Save zone</button>
      <button type="button" onClick={onCancel} className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm">Cancel</button>
    </div>
  </form>;
}
