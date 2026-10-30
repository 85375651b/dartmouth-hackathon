"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createTripSettingsDraft, validateTripSettings } from "@/lib/trip-settings";
import { usePackWise } from "@/state/packwise-store";

export function TripSettings() {
  const { data, dispatch } = usePackWise();
  const [draft, setDraft] = useState(() => createTripSettingsDraft(data));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const savedHere = useRef(false);
  const form = useRef<HTMLFormElement>(null);

  // Only saved settings or Reset demo replace these entities. Item moves do not.
  useEffect(() => {
    setDraft(createTripSettingsDraft(data));
    setErrors({});
    setMessage(savedHere.current ? "Settings saved. Existing item assignments were preserved." : "");
    savedHere.current = false;
  }, [data.trip, data.suitcases]); // eslint-disable-line react-hooks/exhaustive-deps

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateTripSettings(draft);
    setErrors(nextErrors);
    setMessage("");
    if (Object.keys(nextErrors).length) {
      // Focus the first invalid input after React renders the field messages.
      requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    savedHere.current = true;
    dispatch({ type: "saveTripSettings", draft });
  }

  function field(id: string, label: string, value: string, change: (value: string) => void, numeric = false, whole = false) {
    return (
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium">{label}</label>
        <input id={id} name={id} type={numeric ? "number" : "text"}
          step={numeric ? (whole ? "1" : "any") : undefined}
          inputMode={numeric ? (whole ? "numeric" : "decimal") : undefined}
          value={value} required aria-invalid={Boolean(errors[id])}
          aria-describedby={errors[id] ? `${id}-error` : undefined}
          onChange={(event) => { change(event.target.value); setMessage(""); setErrors((old) => { const next = { ...old }; delete next[id]; return next; }); }}
          className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 aria-invalid:border-red-600" />
        {errors[id] && <p id={`${id}-error`} className="mt-1 text-sm text-red-700">{errors[id]}</p>}
      </div>
    );
  }

  return (
    <section aria-labelledby="settings-heading" className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 id="settings-heading" className="text-lg font-semibold">Trip settings</h2>
      <p id="settings-help" className="mt-1 text-sm text-stone-600">Changes stay in this tab. Reloading the page or choosing Reset demo restores the sample settings.</p>
      <form ref={form} noValidate onSubmit={submit} aria-describedby="settings-help" className="mt-4 space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          {field("destination", "Destination", draft.destination, (value) => setDraft({ ...draft, destination: value }))}
          {field("durationDays", "Trip length (days)", draft.durationDays, (value) => setDraft({ ...draft, durationDays: value }), true, true)}
          {field("purpose", "Travel purpose", draft.purpose, (value) => setDraft({ ...draft, purpose: value }))}
        </div>
        <p className="text-sm text-stone-600">Maximum total weight includes the empty suitcase. Estimated volume does not guarantee physical fit. Verify your baggage limits with your airline.</p>
        <div className="grid gap-4 md:grid-cols-2">
          {draft.suitcases.map((bag, index) => {
            const suitcase = data.suitcases[index];
            return (
              <fieldset key={bag.id} className="min-w-0 space-y-3 rounded-lg border border-stone-200 p-4">
                <legend className="px-1 text-sm font-semibold">{suitcase.name} · {suitcase.kind}</legend>
                {([ ["capacityLiters", "Estimated usable capacity (L)"], ["maxWeightKg", "Maximum total weight (kg)"], ["emptyWeightKg", "Empty suitcase weight (kg)"] ] as const).map(([key, label]) => (
                  <div key={key}>{field(`${bag.id}-${key}`, label, bag[key], (value) => setDraft({ ...draft, suitcases: draft.suitcases.map((entry) => entry.id === bag.id ? { ...entry, [key]: value } : entry) }), true)}</div>
                ))}
              </fieldset>
            );
          })}
        </div>
        {Object.keys(errors).length > 0 && <p role="alert" className="text-sm text-red-700">Settings were not saved. Correct the highlighted fields.</p>}
        <p role="status" className="text-sm text-brand-700">{message}</p>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">Save settings</button>
          <button type="button" onClick={() => { setDraft(createTripSettingsDraft(data)); setErrors({}); setMessage("Unsaved changes discarded."); }} className="rounded-md border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">Cancel</button>
        </div>
      </form>
    </section>
  );
}
