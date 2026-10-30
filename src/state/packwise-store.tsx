"use client";

/**
 * In-memory PackWise state. Lives only in the browser tab: a page reload
 * resets to the demo data. No localStorage, server, or database.
 */
import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";
import { createDemoData } from "@/lib/demo-data";
import { applyTripSettings, type TripSettingsDraft } from "@/lib/trip-settings";
import type { ItemId, PackWiseData, RoomZoneId, SuitcaseId } from "@/lib/types";

export type PackWiseAction =
  | { type: "saveTripSettings"; draft: TripSettingsDraft }
  | { type: "assignItemToSuitcase"; itemId: ItemId; suitcaseId: SuitcaseId }
  | { type: "assignItemToZone"; itemId: ItemId; roomZoneId: RoomZoneId }
  | { type: "resetDemo" };

export function packWiseReducer(state: PackWiseData, action: PackWiseAction): PackWiseData {
  switch (action.type) {
    case "saveTripSettings":
      return applyTripSettings(state, action.draft);
    case "assignItemToSuitcase": {
      const { itemId, suitcaseId } = action;
      const others = state.packingPlan.assignments.filter((a) => a.itemId !== itemId);
      const packOrder = 1 + Math.max(0, ...others.filter((a) => a.suitcaseId === suitcaseId).map((a) => a.packOrder));
      return {
        ...state,
        packingPlan: {
          ...state.packingPlan,
          assignments: [...others, { itemId, suitcaseId, packOrder }],
          unassignedItemIds: state.packingPlan.unassignedItemIds.filter((id) => id !== itemId),
        },
      };
    }
    case "assignItemToZone": {
      const { itemId, roomZoneId } = action;
      const others = state.unpackingPlan.assignments.filter((a) => a.itemId !== itemId);
      const unpackOrder = 1 + Math.max(0, ...others.map((a) => a.unpackOrder));
      return {
        ...state,
        unpackingPlan: {
          ...state.unpackingPlan,
          assignments: [...others, { itemId, roomZoneId, unpackOrder }],
          unassignedItemIds: state.unpackingPlan.unassignedItemIds.filter((id) => id !== itemId),
        },
      };
    }
    case "resetDemo":
      return createDemoData();
  }
}

interface PackWiseContextValue {
  data: PackWiseData;
  dispatch: (action: PackWiseAction) => void;
}

const PackWiseContext = createContext<PackWiseContextValue | null>(null);

export function PackWiseProvider({ children }: { children: ReactNode }) {
  const [data, dispatch] = useReducer(packWiseReducer, undefined, createDemoData);
  const value = useMemo(() => ({ data, dispatch }), [data]);
  return <PackWiseContext.Provider value={value}>{children}</PackWiseContext.Provider>;
}

export function usePackWise(): PackWiseContextValue {
  const context = useContext(PackWiseContext);
  if (!context) throw new Error("usePackWise must be used inside <PackWiseProvider>.");
  return context;
}
