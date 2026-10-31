"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import type { Cleanliness, Item, ItemCategory, ItemId } from "@/lib/types";
import { validateInventoryMeasurements } from "@/lib/inventory";
import { formatMeasurementNumber as numberText } from "@/lib/units";

const categories: { value: ItemCategory; label: string }[] = [
  { value: "clothing", label: "Clothing" }, { value: "shoes", label: "Shoes" },
  { value: "electronics", label: "Electronics" }, { value: "toiletries", label: "Toiletries" },
  { value: "documents", label: "Documents" }, { value: "other", label: "Other" },
  { value: "linens", label: "Linens" }, { value: "kitchen", label: "Kitchen" },
  { value: "study", label: "Study" }, { value: "personal", label: "Personal" },
];

const inputClass = "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-2 focus:outline-brand-100";
const buttonClass = "rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-brand-600";
const blank = { name: "", category: "clothing" as ItemCategory, weight: "", volume: "", fragile: false, cleanliness: "clean" as Cleanliness, carryOn: false };
type Errors = Partial<Record<"name" | "weight" | "volume", string>>;

/** Controlled inventory: the parent owns items, so every update is shared immediately. */
export function InventoryEditor({ items, onChange }: { items: Item[]; onChange: (items: Item[]) => void }) {
  const prefix = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState({ ...blank });
  const [editingId, setEditingId] = useState<ItemId | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState("");
  // A demo reset or external deletion must not leave a stale item in the form.
  const editingItem = items.find((item) => item.id === editingId);
  const staleEdit = editingId !== null && !editingItem;
  const knownKg = items.reduce((sum, item) => sum + (item.weightKg ?? 0), 0);
  const unknownWeights = items.filter((item) => item.weightKg === null).length;

  function reset() {
    setDraft({ ...blank });
    setEditingId(null);
    setErrors({});
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const weight = draft.weight.trim() === "" ? null : Number(draft.weight);
    const volume = draft.volume.trim() === "" ? null : Number(draft.volume);
    const nextErrors: Errors = validateInventoryMeasurements(items, editingId, weight, volume);
    const badNumber = (field: string) => (event.currentTarget.elements.namedItem(`${prefix}-${field}`) as HTMLInputElement).validity.badInput;
    if (!draft.name.trim()) nextErrors.name = "Enter an item name.";
    if (badNumber("weight") || (weight !== null && (!Number.isFinite(weight) || weight < 0))) nextErrors.weight = "Weight must be a valid number of 0 kg or more.";
    if (badNumber("volume") || (volume !== null && (!Number.isFinite(volume) || volume <= 0))) nextErrors.volume = "Volume must be a valid number greater than 0 L.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length || staleEdit) return;
    const item: Item = {
      ...editingItem,
      id: editingItem?.id ?? `item-${crypto.randomUUID()}`,
      name: draft.name.trim(), category: draft.category, weightKg: weight, volumeLiters: volume,
      dimensionsCm: editingItem?.dimensionsCm ?? null,
      quantity: editingItem?.quantity ?? 1,
      fragility: draft.fragile ? "fragile" : editingItem?.fragility === "sturdy" ? "sturdy" : "normal",
      cleanliness: draft.cleanliness, carryOnRequired: draft.carryOn,
    };
    onChange(editingItem ? items.map((current) => current.id === item.id ? item : current) : [...items, item]);
    setStatus(`${item.name} ${editingItem ? "updated" : "added"}.`);
    reset();
    nameRef.current?.focus();
  }

  function edit(item: Item) {
    setEditingId(item.id);
    setDraft({ name: item.name, category: item.category, weight: item.weightKg?.toString() ?? "", volume: item.volumeLiters?.toString() ?? "", fragile: item.fragility === "fragile", cleanliness: item.cleanliness ?? "clean", carryOn: item.carryOnRequired });
    setErrors({});
    setStatus(`Editing ${item.name}.`);
    nameRef.current?.focus();
  }

  function error(field: keyof Errors) {
    return errors[field] ? <p id={`${prefix}-${field}-error`} className="mt-1 text-sm text-red-700">{errors[field]}</p> : null;
  }

  return (
    <section aria-labelledby={`${prefix}-heading`}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Your packing list</p>
          <h2 id={`${prefix}-heading`} className="mt-1 text-2xl font-semibold">Inventory</h2>
        </div>
        <p className="text-sm text-stone-500">Add what you know. Confirm measurements later.</p>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <form onSubmit={submit} noValidate className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold">{editingId ? "Edit item" : "Add an item"}</h3>
          <p className="mt-1 text-sm text-stone-500">Only the name is required. Blank measurements stay unknown.</p>
          <div className="mt-5 space-y-4">
            <div>
              <label htmlFor={`${prefix}-name`} className="text-sm font-medium">Item name <span className="text-stone-500">(required)</span></label>
              <input ref={nameRef} id={`${prefix}-name`} required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-invalid={!!errors.name} aria-describedby={errors.name ? `${prefix}-name-error` : undefined} className={inputClass} placeholder="e.g. Laptop" />
              {error("name")}
            </div>
            <div>
              <label htmlFor={`${prefix}-category`} className="text-sm font-medium">Category</label>
              <select id={`${prefix}-category`} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as ItemCategory })} className={inputClass}>
                {categories.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${prefix}-weight`} className="text-sm font-medium">Weight (kg)</label>
                <input id={`${prefix}-weight`} type="number" min="0" step="any" value={draft.weight} onChange={(e) => setDraft({ ...draft, weight: e.target.value })} aria-invalid={!!errors.weight} aria-describedby={errors.weight ? `${prefix}-weight-error` : undefined} className={inputClass} placeholder="Unknown" />
                {error("weight")}
              </div>
              <div>
                <label htmlFor={`${prefix}-volume`} className="text-sm font-medium">Volume (L)</label>
                <input id={`${prefix}-volume`} type="number" min="0" step="any" value={draft.volume} onChange={(e) => setDraft({ ...draft, volume: e.target.value })} aria-invalid={!!errors.volume} aria-describedby={errors.volume ? `${prefix}-volume-error` : undefined} className={inputClass} placeholder="Unknown" />
                {error("volume")}
              </div>
            </div>
            <div>
              <label htmlFor={`${prefix}-cleanliness`} className="text-sm font-medium">Cleanliness</label>
              <select id={`${prefix}-cleanliness`} value={draft.cleanliness} onChange={(e) => setDraft({ ...draft, cleanliness: e.target.value as Cleanliness })} className={inputClass}>
                <option value="clean">Clean</option><option value="dirty">Dirty</option><option value="protected">Protected</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.fragile} onChange={(e) => setDraft({ ...draft, fragile: e.target.checked })} className="size-4 accent-brand-600" />Fragile</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.carryOn} onChange={(e) => setDraft({ ...draft, carryOn: e.target.checked })} className="size-4 accent-brand-600" />Must be in carry-on</label>
            {editingItem && <p className="text-xs text-stone-500">Measurements apply to the whole entry ({editingItem.quantity} unit{editingItem.quantity === 1 ? "" : "s"}). Existing notes and dimensions are preserved.</p>}
            {staleEdit && <p role="alert" className="text-sm text-red-700">This item was removed or the demo was reset. Cancel to add a new item.</p>}
            <div className="flex flex-wrap gap-2 border-t border-stone-100 pt-4">
              <button disabled={staleEdit} type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50">{editingId ? "Save changes" : "Add Item"}</button>
              {editingId && <button type="button" onClick={() => { reset(); setStatus("Editing canceled. No changes saved."); }} className={buttonClass}>Cancel</button>}
            </div>
          </div>
        </form>
        <div className="min-w-0 rounded-xl border border-stone-200 bg-white shadow-sm">
          <div className="rounded-t-xl border-b border-stone-200 bg-brand-50 px-5 py-4" aria-live="polite">
            <h3 className="font-semibold">{items.length} {items.length === 1 ? "item" : "items"} · {numberText(knownKg)} kg known weight</h3>
            <p className={`mt-1 text-sm ${unknownWeights ? "text-amber-800" : "text-stone-600"}`}>{unknownWeights ? `${unknownWeights} ${unknownWeights === 1 ? "item has" : "items have"} unknown weight. Total is incomplete.` : "All item weights are known."}</p>
          </div>
          {items.length === 0 ? <div className="px-6 py-14 text-center"><h4 className="font-semibold">Your next trip starts here</h4><p className="mt-2 text-sm text-stone-500">Add your first item using the form. You can fill in its measurements later.</p></div> : (
            <ul className="max-h-[650px] divide-y divide-stone-100 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id} className={`p-5 ${editingId === item.id ? "bg-brand-50" : ""}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h4 className="break-words font-semibold">{item.name}{item.quantity > 1 && ` ×${item.quantity}`}</h4>
                      <p className="mt-1 text-xs capitalize text-stone-500">{item.category} · {item.cleanliness ?? "clean"}</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => edit(item)} aria-label={`Edit ${item.name}`} className={buttonClass}>Edit</button>
                      <button type="button" onClick={() => { onChange(items.filter((current) => current.id !== item.id)); if (editingId === item.id) reset(); setStatus(`${item.name} deleted.`); }} aria-label={`Delete ${item.name}`} className={`${buttonClass} text-red-700`}>Delete</button>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-stone-600">{item.weightKg === null ? "Weight unknown" : `${numberText(item.weightKg)} kg`} · {item.volumeLiters === null ? "Volume unknown" : `${numberText(item.volumeLiters)} L`}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-stone-100 px-2 py-1">{item.fragility === "fragile" ? "Fragile" : "Not fragile"}</span>
                    <span className="rounded-full bg-brand-50 px-2 py-1 text-brand-700">{item.carryOnRequired ? "Carry-on required" : "Any suitcase"}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p role="status" className="mt-2 min-h-5 text-sm text-brand-700">{status}</p>
      <p className="text-xs text-stone-500">Changes are kept in this tab only. Refreshing restores the demo. New items remain unassigned to suitcases and room zones.</p>
    </section>
  );
}
