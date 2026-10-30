"use client";

import { DEMO_LABEL } from "@/lib/demo-data";
import { usePackWise } from "@/state/packwise-store";

/** Marks bundled sample content so it is never mistaken for real user data. */
export function DemoBanner() {
  const { data, dispatch } = usePackWise();
  if (!data.trip.isDemo) return null;
  return (
    <div
      role="note"
      className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between"
    >
      <p>
        <span className="mr-2 rounded bg-amber-200 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide">
          {DEMO_LABEL}
        </span>
        A fictional study-abroad trip for trying PackWise. Changes stay in this tab and reset on reload.
      </p>
      <button
        type="button"
        onClick={() => dispatch({ type: "resetDemo" })}
        className="self-start rounded-md border border-amber-400 bg-white px-3 py-1.5 font-medium hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 sm:self-auto"
      >
        Reset demo
      </button>
    </div>
  );
}
