"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CABIN_CLASSES, createTripSettingsDraft, missingFlightDetails, validateTripSettings } from "@/lib/trip-settings";
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

  function field(id: string, label: string, value: string, change: (value: string) => void, numeric = false, whole = false, required = true, inputType?: "date") {
    return (
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium">{label}</label>
        <input id={id} name={id} type={inputType ?? (numeric ? "number" : "text")}
          step={numeric ? (whole ? "1" : "any") : undefined}
          inputMode={numeric ? (whole ? "numeric" : "decimal") : undefined}
          value={value} required={required} aria-invalid={Boolean(errors[id])}
          onInput={inputType === "date" ? (event) => { change(event.currentTarget.value); setMessage(""); setErrors((old) => { const next = { ...old }; delete next[id]; return next; }); } : undefined}
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
        <div className="grid gap-4 sm:grid-cols-2">
          {field("destination", "Destination", draft.destination, (value) => setDraft({ ...draft, destination: value }))}
          {field("durationDays", "Trip length (days)", draft.durationDays, (value) => setDraft({ ...draft, durationDays: value }), true, true)}
        </div>
        <fieldset className="space-y-4 rounded-lg border border-stone-200 p-4">
          <legend className="px-1 font-semibold">Flight and baggage details</legend>
          <p className="text-sm text-stone-600">Optional for manual packing. Details stay in this tab; no policy search or airline verification is performed.</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!draft.flight.detailsKnown} onChange={(event) => {
              setDraft({ ...draft, flight: { ...draft.flight, detailsKnown: !event.target.checked } });
              setErrors({}); setMessage("");
            }} />
            I don't have flight details yet
          </label>
          {field("departureDate", "Departure date (optional)", draft.departureDate, (value) => setDraft({ ...draft, departureDate: value }), false, false, false, "date")}
          {draft.flight.detailsKnown && <>
            <div className="grid gap-4 sm:grid-cols-2">
              {([
                ["operatingAirline", "Operating airline (if known)"],
                ["flightNumber", "Flight number, including airline prefix (e.g. BA 123)"],
                ["originAirport", "Origin airport (e.g. BOS or Boston Logan)"],
                ["destinationAirport", "Destination airport (e.g. BCN or Barcelona El Prat)"],
                ["fareBrand", "Fare brand or ticket type (optional)"],
                ["baggageBenefits", "Airline status or baggage benefits (optional)"],
              ] as const).map(([key, label]) => <div key={key}>{field(key, label, draft.flight[key], (value) => setDraft({ ...draft, flight: { ...draft.flight, [key]: value } }), false, false, false)}</div>)}
            </div>
            <p className="text-sm text-stone-600">The operating airline is the company actually flying the plane, which may differ from the airline that sold your ticket. Unknown airline or fare? Leave it blank. For benefits, describe loyalty status or a qualifying card benefit; do not enter card numbers or booking references.</p>
            <div>
              <label htmlFor="cabinClass" className="block text-sm font-medium">Cabin class</label>
              <select id="cabinClass" value={draft.flight.cabinClass} aria-invalid={Boolean(errors.cabinClass)} aria-describedby={errors.cabinClass ? "cabinClass-error" : undefined}
                onChange={(event) => { setDraft({ ...draft, flight: { ...draft.flight, cabinClass: event.target.value } }); setMessage(""); }}
                className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2">
                {CABIN_CLASSES.map((option) => <option key={option}>{option}</option>)}
              </select>
              {errors.cabinClass && <p id="cabinClass-error" className="text-sm text-red-700">{errors.cabinClass}</p>}
            </div>
          </>}
          {field("checkedBagCount", "Number of checked bags you expect to bring", draft.flight.checkedBagCount, (value) => setDraft({ ...draft, flight: { ...draft.flight, checkedBagCount: value } }), true, true)}
          {draft.flight.checkedBagCount.trim() && Number.isSafeInteger(Number(draft.flight.checkedBagCount)) && Number(draft.flight.checkedBagCount) >= 0 && Number(draft.flight.checkedBagCount) !== data.suitcases.filter((bag) => bag.kind === "checked").length &&
            <p className="text-sm text-amber-900">You expect {draft.flight.checkedBagCount} checked bags; this plan contains {data.suitcases.filter((bag) => bag.kind === "checked").length}. Saving does not add or remove suitcases.</p>}
          <p className="text-sm text-stone-600">{missingFlightDetails(draft).length ? `For a future policy lookup, add or confirm: ${missingFlightDetails(draft).join(", ")}. You can save and pack manually now.` : "Details entered for a future lookup. No baggage policy or fee has been verified."}</p>
          <p className="text-sm text-stone-600">Baggage allowances and fees depend on your route, travel date, fare, and benefits. Confirm the final rules with your airline.</p>
          <p className="text-sm text-stone-600">One flight segment only. Connections, return flights, and codeshares may require additional policy checks. A flight number alone does not establish baggage allowance or pricing.</p>
        </fieldset>
        <p className="text-sm text-stone-600">Maximum total weight includes the empty suitcase. Approximate empty weight is your estimate of the bag before adding belongings. Weight limits below are manual settings, not verified airline allowances. Airline baggage limits do not establish usable interior volume.</p>
        <div className="grid gap-4 md:grid-cols-2">
          {draft.suitcases.map((bag, index) => {
            const suitcase = data.suitcases[index];
            return (
              <fieldset key={bag.id} className="min-w-0 space-y-3 rounded-lg border border-stone-200 p-4">
                <legend className="px-1 text-sm font-semibold">{suitcase.name} · {suitcase.kind}</legend>
                {([ ["maxWeightKg", "Maximum total weight (kg)"], ["emptyWeightKg", "Approximate empty suitcase weight (kg)"] ] as const).map(([key, label]) => (
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
