"use client";

/**
 * In-memory PackWise state. Lives only in the browser tab: a page reload
 * resets to the demo data. No localStorage, server, or database.
 */
import { createContext, useContext, useMemo, useReducer, useCallback, type ReactNode } from "react";
import { createDemoData } from "@/lib/demo-data";
import { applyTripSettings, type TripSettingsDraft } from "@/lib/trip-settings";
import { applyAreaPlan } from "@/lib/photo-packing/plan";
import type { AreaPlan } from "@/lib/photo-packing/types";
import { saveRoomZone, setRoomZoneConfirmation, removeRoomZone, type RoomZoneDraft } from "@/lib/room-zones";
import type { Item, ItemId, PackWiseData, RoomZoneId, SuitcaseId } from "@/lib/types";

export type PackWiseAction =
  | { type: "applyAreaPlan"; plan: AreaPlan }
  | { type: "setItems"; items: Item[] }
  | { type: "saveRoomZone"; draft: RoomZoneDraft; id: RoomZoneId; creating: boolean }
  | { type: "confirmRoomZone"; id: RoomZoneId; confirmed: boolean }
  | { type: "removeRoomZone"; id: RoomZoneId }
  | { type: "saveTripSettings"; draft: TripSettingsDraft }
  | { type: "assignItemToSuitcase"; itemId: ItemId; suitcaseId: SuitcaseId }
  | { type: "assignItemToZone"; itemId: ItemId; roomZoneId: RoomZoneId }
  | { type: "resetDemo" };

export function packWiseReducer(state: PackWiseData, action: PackWiseAction): PackWiseData {
  switch (action.type) {
    case "applyAreaPlan": return applyAreaPlan(state, action.plan);
    case "saveRoomZone":
      return saveRoomZone(state, action.draft, action.id, action.creating);
    case "confirmRoomZone":
      return setRoomZoneConfirmation(state, action.id, action.confirmed);
    case "removeRoomZone":
      return removeRoomZone(state, action.id);
    case "saveTripSettings":
      return applyTripSettings(state, action.draft);
    case "setItems": {
      const ids = new Set(action.items.map((item) => item.id));
      // Keep existing assignments unless deleted or now incompatible with carry-on rules.
      const packingAssignments = state.packingPlan.assignments.filter((assignment) => {
        const item = action.items.find((item) => item.id === assignment.itemId);
        return item && (!item.carryOnRequired || state.suitcases.some(
          (suitcase) => suitcase.id === assignment.suitcaseId && suitcase.kind === "carry-on",
        ));
      });
      const unpackingAssignments = state.unpackingPlan.assignments.filter((a) => ids.has(a.itemId));
      return {
        ...state,
        items: action.items,
        trip: { ...state.trip, itemIds: [...ids] },
        packingPlan: {
          ...state.packingPlan,
          assignments: packingAssignments,
          unassignedItemIds: [...ids].filter((id) => !packingAssignments.some((a) => a.itemId === id)),
        },
        unpackingPlan: {
          ...state.unpackingPlan,
          assignments: unpackingAssignments,
          unassignedItemIds: [...ids].filter((id) => !unpackingAssignments.some((a) => a.itemId === id)),
        },
      };
    }
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
  resetVersion: number;
  dispatch: (action: PackWiseAction) => void;
}

const PackWiseContext = createContext<PackWiseContextValue | null>(null);

export function PackWiseProvider({ children }: { children: ReactNode }) {
  const [data, rawDispatch] = useReducer(packWiseReducer, undefined, createDemoData);
  const [resetVersion, bumpResetVersion] = useReducer((value: number) => value + 1, 0);
  const dispatch = useCallback((action: PackWiseAction) => {
    rawDispatch(action);
    if (action.type === "resetDemo") bumpResetVersion();
  }, []);
  const value = useMemo(() => ({ data, dispatch, resetVersion }), [data, dispatch, resetVersion]);
  return <PackWiseContext.Provider value={value}>{children}</PackWiseContext.Provider>;
}

export function usePackWise(): PackWiseContextValue {
  const context = useContext(PackWiseContext);
  if (!context) throw new Error("usePackWise must be used inside <PackWiseProvider>.");
  return context;
}
