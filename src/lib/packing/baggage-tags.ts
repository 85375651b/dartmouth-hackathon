/** PackWise's requested baggage-rule subset, based on TSA/FAA guidance.
 * These tags do not constitute permission to fly or an exhaustive rules check.
 */
export type BaggageTag = "carry-on-only" | "checked-only" | "needs-review" | "no-matching-rule" | "prohibited";

export interface BaggageAdvice {
  tag: BaggageTag;
  reviewRequired: boolean;
  reasons: string[];
}

/** Details supplied after identification; never infer these from packed volume.
 * All values apply to each individual container/tool, not the quantity total.
 */
export interface BaggageDetails {
  containerCapacityLiters?: number | null;
  physicalForm?: "liquid" | "gel" | "aerosol" | "solid";
  isEmptyContainer?: boolean;
  liquidException?: "medical" | "infant" | "duty-free";
  toolLengthCm?: number;
  scissorsBladeLengthCm?: number;
}

export const BAGGAGE_RULES_REVIEWED_ON = "2026-10-31";
export const BAGGAGE_RULE_SOURCES = {
  batteries: "https://www.faa.gov/hazmat/packsafe/lithium-batteries",
  vapes: "https://www.faa.gov/hazmat/packsafe/e-cigarettes-vaping",
  liquids: "https://www.tsa.gov/travel/security-screening/liquids-rule",
  blades: "https://www.tsa.gov/travel/security-screening/whatcanibring/items/knives",
  tools: "https://www.tsa.gov/travel/security-screening/whatcanibring/items/tools",
  aerosols: "https://www.faa.gov/hazmat/packsafe/aerosols",
} as const;

/** Product names that use the existing liquids rule; no inferred container contents. */
export function isLiquidProductLabel(label: string): boolean {
  const name = label.toLowerCase().replace(/[‐‑–—-]/g, " ");
  return /\b(vape (?:juice|liquid)|e liquid|e juice|aerosols?|hair ?spray|spray deodorants?|shaving foams?|liquids?|gels?|shampoos?|conditioners?|lotions?|creams?|toothpaste|mouthwash|perfumes?|colognes?|sunscreen|saniti[sz]ers?|shaving cream|water|juice|oils?|deodorants?|soap)\b/.test(name);
}

/** No AI, requests, mutations, or count adjustments in this stage. */
export function tagBaggageRequirements<T extends { name: string }>(
  objects: readonly (T & BaggageDetails)[],
): (T & BaggageDetails & { baggage: BaggageAdvice })[] {
  return objects.map((object) => ({ ...object, baggage: classifyBaggage(object) }));
}

function classifyBaggage(object: { name: string } & BaggageDetails): BaggageAdvice {
  for (const value of [object.containerCapacityLiters, object.toolLengthCm, object.scissorsBladeLengthCm]) {
    if (value != null && (!Number.isFinite(value) || value <= 0)) {
      throw new RangeError("Baggage sizes must be positive finite values in liters or centimeters.");
    }
  }
  const name = object.name.toLowerCase().replace(/[‐‑–—-]/g, " ").replace(/\s+/g, " ").trim();
  const advice = (tag: BaggageTag, reasons: string[], reviewRequired = tag === "needs-review" || tag === "prohibited"): BaggageAdvice => ({ tag, reviewRequired, reasons });
  if ((/\b(cables?|covers?|holders?|pouches?|sheaths?)\b/.test(name) || /\bempty\b.*\bcases?\b/.test(name)) && !/\b(with|and)\b/.test(name)) {
    return advice("no-matching-rule", ["This label describes an accessory; do not apply the device or blade rule to it."]);
  }
  if (/\b(spray paint|wd ?40)\b/.test(name)) {
    return advice("prohibited", ["Non-toiletry flammable aerosols are prohibited in both carry-on and checked baggage."]);
  }

  const reasons: string[] = [];
  let carryOn = false;
  let checked = false;
  let review = false;
  const vapeLiquid = /\b(vape (?:juice|liquid)|e liquid|e juice)\b/.test(name);
  if (/\b(power ?banks?|portable (?:battery )?chargers?|battery charging cases?)\b/.test(name)
    || /^(?:(?:spare|loose|uninstalled|replacement|rechargeable) )*(?:lithium(?: ion| metal)?|li ion) batter(?:y|ies)(?: packs?)?$/.test(name)
    || /\b(?:spare|loose|uninstalled)\b.*\b(?:lithium|li ion)\b.*\bbatter/.test(name)
    || /\b(?:lithium|li ion)\b.*\b(?:spare|loose|uninstalled)\b.*\bbatter/.test(name)) {
    carryOn = true;
    reasons.push("Spare lithium batteries and power banks must stay in the cabin, including when a carry-on is gate-checked. Protect terminals and check battery ratings and airline limits.");
  } else if (/\bbatter(?:y|ies)\b/.test(name)) {
    review = true;
    reasons.push("Confirm battery chemistry and whether it is spare or installed before choosing a bag.");
  }
  if (!vapeLiquid && /\b(e (?:cigarettes?|cigs?)|electronic cigarettes?|vapes?|vaping devices?)\b/.test(name)) {
    carryOn = true;
    reasons.push("Electronic smoking devices must stay in the cabin. Prevent accidental activation; do not use or recharge them on board.");
  }
  if (/\b(toiletry bags?|toiletries)\b/.test(name)) {
    review = true;
    reasons.push("Identify the individual toiletry containers and their capacities before applying liquid rules.");
  }

  const enclosedRazor = /\b(disposable|cartridge|electric) razors?\b/.test(name);
  const exemptKnife = /\b(plastic (?:knives|knife)|round bladed butter (?:knives|knife))\b/.test(name);
  if (!enclosedRazor && !exemptKnife
    && /\b(knives|knife|box cutters?|utility (?:knives|knife|blades?)|razor blades?|straight razors?|sharp blades?|saw blades?)\b/.test(name)) {
    checked = true;
    reasons.push("Sharp knives and loose blades belong in checked baggage; sheath or securely wrap them.");
  } else if (!enclosedRazor && /\brazors?\b/.test(name)) {
    review = true;
    reasons.push("Confirm razor type: an enclosed disposable/cartridge razor differs from a loose blade.");
  }

  const handTool = /\b(screwdrivers?|wrench(?:es)?|spanners?|pliers)\b/.test(name);
  const powerTool = /\b(power tools?|(?:cordless |electric )?drills?|power saws?|chainsaws?)\b/.test(name);
  const otherTool = /\b(tools?|hammers?|chisels?|crowbars?|saws?|drill bits?)\b/.test(name);
  const standaloneSpareBattery = carryOn && /\bbatter(?:y|ies)(?: packs?)?$/.test(name) && !/\b(with|and)\b/.test(name);
  if (!standaloneSpareBattery && (powerTool || otherTool || handTool)) {
    if (handTool && !powerTool && !otherTool && object.toolLengthCm != null && object.toolLengthCm <= 17.78) {
      reasons.push("This hand tool does not exceed the TSA 17.78 cm (7 inch) length threshold; confirm its specific type and itinerary.");
    } else {
      checked = true;
      const unknownHandTool = handTool && object.toolLengthCm == null;
      review ||= unknownHandTool || powerTool;
      reasons.push(unknownHandTool
        ? "PackWise conservatively routes unmeasured tools to checked baggage. Small hand-tool exceptions require confirming the type and assembled length."
        : "Pack tools in checked baggage. Power tools and tools over 17.78 cm cannot go in carry-on baggage; check power-tool batteries separately.");
    }
  }
  if (/\bscissors\b/.test(name)) {
    if (object.scissorsBladeLengthCm == null) {
      review = true;
      reasons.push("Confirm scissor blade length measured from the pivot; the TSA carry-on threshold is less than 10.16 cm (4 inches).");
    } else if (object.scissorsBladeLengthCm >= 10.16) {
      checked = true;
      reasons.push("Scissor blades at least 10.16 cm from the pivot should be packed in checked baggage.");
    }
  }

  const aerosol = object.physicalForm === "aerosol" || /\b(aerosols?|hair ?spray|spray deodorants?|shaving foams?)\b/.test(name);
  const liquid = vapeLiquid || aerosol || object.physicalForm === "liquid" || object.physicalForm === "gel"
    || isLiquidProductLabel(name);
  const exception = object.liquidException != null || /\b(medicines?|medications?|insulin|breast ?milk|baby formula|infant formula|duty free)\b/.test(name);
  if (exception) {
    review = true;
    reasons.push("Medical, infant-feeding, and certain duty-free liquids can have exceptions; confirm the applicable screening procedure instead of forcing checked baggage.");
  } else if (liquid && object.physicalForm !== "solid" && !object.isEmptyContainer) {
    const capacity = object.containerCapacityLiters;
    if (aerosol && capacity != null && capacity > 0.5) {
      return advice("prohibited", ["An aerosol container over 0.5 L exceeds the FAA medicinal/toiletry and permitted nonflammable-aerosol container limit."]);
    }
    if (capacity == null) {
      review = true;
      reasons.push("Confirm each container's labeled capacity. The 0.1 L limit uses container size, not remaining contents, quantity, or estimated packed volume.");
    } else if (capacity > 0.1) {
      checked = true;
      reasons.push("This liquid, gel, or aerosol container exceeds 0.1 L (100 mL) and belongs in checked baggage unless an exception applies.");
    } else {
      reasons.push("Each container is at most 0.1 L; carry-on liquids must also meet the applicable liquids-bag and screening rules.");
    }
    if (aerosol) {
      review = true;
      reasons.push("Confirm aerosol contents, protective cap, and aggregate limits; not every aerosol is permitted in checked baggage.");
    }
  }
  if (carryOn && checked) return advice("needs-review", [...reasons, "Conflicting bag requirements: split this mixed entry into separate objects before packing."]);
  if (carryOn) return advice("carry-on-only", reasons, review);
  if (checked) return advice("checked-only", reasons, review);
  if (review) return advice("needs-review", reasons);
  return advice("no-matching-rule", reasons);
}
