import type { DetectedObject, TaggedDetectedObject } from '../vision/identify-objects.ts';
import { tagIdentifiedObject } from '../vision/identify-objects.ts';
import type { BaggageDetails } from '../packing/baggage-tags.ts';
import type { Analysis } from '../photo-packing/types.ts';
import type { UserInputs } from './contracts.ts';
import { packingItemId } from '../packing/bundles.ts';
import { PLACEHOLDER_CONTAINER_LITERS } from './placeholders.ts';
import type { ItemId } from '../types.ts';

export interface ContainerCapacity {
  capacityLiters: number;
  source: 'dimensions_estimate' | 'rated' | 'placeholder';
  /** Explicit application limit, NOT implicitly the 100 ml cabin threshold. */
  maximumLiters?: number;
}

/** Outer dimensions give an envelope estimate, not rated internal capacity.
 * A dimensions stage can call this when it actually has all three dimensions;
 * pixels-per-inch alone cannot supply an unseen third dimension.
 */
export function estimate_container_capacity(dimsCm: number[], shape: 'box' | 'cylinder', heightAxis: 0 | 1 | 2 = 2): ContainerCapacity {
  if (dimsCm.length !== 3 || dimsCm.some(d => !Number.isFinite(d) || d <= 0) || ![0, 1, 2].includes(heightAxis)) throw new Error('Capacity estimation requires three positive measured dimensions and a height axis.');
  const cross = dimsCm.filter((_, i) => i !== heightAxis);
  const volume = shape === 'box' ? dimsCm.reduce((a, b) => a * b, 1)
    : shape === 'cylinder' ? Math.PI * (Math.min(...cross) / 2) ** 2 * dimsCm[heightAxis] : NaN;
  if (!Number.isFinite(volume)) throw new Error('Invalid container shape or dimensions.');
  return { capacityLiters: volume / 1000, source: 'dimensions_estimate' };
}

/** Dimensions-stage adapter: never converts a 2D footprint into invented depth.
 * Existing manually confirmed capacity remains authoritative. With only outer
 * geometry, return a provenance-marked estimate for review, not rated capacity.
 */
export function capacity_from_dimensions(object: DetectedObject, analysis: Analysis | undefined, user: UserInputs, id: ItemId = packingItemId(object)): ContainerCapacity | undefined {
  const input = user.items?.[id];
  if (user.containerCapacities?.[id]) return user.containerCapacities[id];
  if (input?.baggage?.containerCapacityLiters != null) return { capacityLiters: input.baggage.containerCapacityLiters, source: 'rated' };
  if (!tagIdentifiedObject(object).flags.includes('assumed_full')) return undefined;
  const dimensions: number[][] = [];
  if (input?.dimsIn) dimensions.push([input.dimsIn.lengthIn, input.dimsIn.widthIn, input.dimsIn.heightIn].map(v => v * 2.54));
  for (const [instanceId, d] of Object.entries(user.instanceDimsIn ?? {})) {
    if (instanceId.startsWith(`${id}:instance:`)) dimensions.push([d.lengthIn, d.widthIn, d.heightIn].map(v => v * 2.54));
  }
  if (!dimensions.length && input?.heightIn && analysis) {
    for (const detection of analysis.items) if (user.matches?.[detection.id]?.startsWith(`${id}:instance:`)) {
      dimensions.push([detection.envelope.lengthCm, detection.envelope.widthCm, input.heightIn * 2.54]);
    }
  }
  if (!dimensions.length) return user.usePlaceholders ? { capacityLiters: PLACEHOLDER_CONTAINER_LITERS, source: 'placeholder' } : undefined;
  return { capacityLiters: Math.max(...dimensions.map(d => estimate_container_capacity(d, input?.liquidShape ?? 'box', input?.heightAxis ?? 2).capacityLiters)), source: 'dimensions_estimate' };
}

/** Preserve original tagging unless an explicit dimension-stage capacity fact
 * exists. ASSUMPTION: "over capacity" means above a separately supplied maximum;
 * no global limit was specified. Rated >100 ml retains the existing checked rule.
 */
export function tag_capacity(object: DetectedObject, details: BaggageDetails = {}, capacity?: ContainerCapacity): TaggedDetectedObject {
  if (!capacity) return tagIdentifiedObject(object, details);
  if (!Number.isFinite(capacity.capacityLiters) || capacity.capacityLiters <= 0
    || capacity.maximumLiters !== undefined && (!Number.isFinite(capacity.maximumLiters) || capacity.maximumLiters <= 0)) throw new Error('Container capacities and explicit limits must be positive finite liters.');
  if (!['rated', 'dimensions_estimate', 'placeholder'].includes(capacity.source)) throw new Error('Unknown capacity source.');
  const tagged = tagIdentifiedObject(object, { ...details, containerCapacityLiters: capacity.capacityLiters });
  // Empty drinking vessels are not liquid products; never prohibit an empty
  // bottle merely because the bottle can hold more liquid than a limit.
  if (!tagged.flags.includes('assumed_full')) return tagged;
  if (capacity.maximumLiters !== undefined && capacity.capacityLiters > capacity.maximumLiters) {
    return { ...tagged, placement_tag: 'prohibited', flags: [...new Set([...tagged.flags, 'placement_review_required' as const])] };
  }
  if (capacity.source === 'dimensions_estimate') {
    return { ...tagged, placement_tag: tagged.placement_tag === 'prohibited' ? 'prohibited' : 'needs-review',
      flags: [...new Set([...tagged.flags, 'placement_review_required' as const])] };
  }
  return tagged;
}
