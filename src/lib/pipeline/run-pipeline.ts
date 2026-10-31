import { postprocessObjectCounts, validateObjectImage } from '../vision/identify-objects.ts';
import { assertBundleInvariants, bundlePackingItems, packingItemId } from '../packing/bundles.ts';
import type { PackingBundle } from '../packing/bundles.ts';
import type { Analysis } from '../photo-packing/types.ts';
import type { Assignment, Instance, LayerResult, PackingUnit, PipelineBag, PipelineImage, PipelineItem, PipelineResult, UserInputs } from './contracts.ts';
import { classifyItem, detectDimensions, estimateVolume, estimateWeight, liters, measureInstances, positive, preferItem, validateDims } from './enrichment.ts';
import { layerBags, makePackingUnits, proposeFallback, unitMass } from './packing-adapters.ts';
import { plan_trip } from './plan-trip.ts';
import { capacity_from_dimensions, tag_capacity } from './container-capacity.ts';
import { importIdentifiedItems, isGarment, projectLedger } from './identity-ledger.ts';
import type { DetectedObject } from '../vision/object-contract.ts';

type MaybePromise<T> = T | Promise<T>;
export interface PipelineStages {
  identify: (image: PipelineImage) => Promise<unknown>;
  normalize: typeof postprocessObjectCounts;
  tag: typeof tag_capacity;
  capacity: typeof capacity_from_dimensions;
  bundle: typeof bundlePackingItems;
  detect: typeof detectDimensions;
  measure: (item: PipelineItem, analysis: Analysis | undefined, user: UserInputs) => MaybePromise<Instance[]>;
  classify: (item: PipelineItem, user: UserInputs) => MaybePromise<PipelineItem['classification']>;
  preferences: (item: PipelineItem, user: UserInputs) => MaybePromise<NonNullable<PipelineItem['preferences']>>;
  weight: (item: PipelineItem, user: UserInputs) => MaybePromise<PipelineItem['weight']>;
  volume: (item: PipelineItem, user: UserInputs) => MaybePromise<PipelineItem['volume']>;
  geometry: (items: PipelineItem[], bundles: PackingBundle[], bags: PipelineBag[], user: UserInputs) => MaybePromise<Awaited<ReturnType<typeof makePackingUnits>>>;
  assign: (units: PackingUnit[], items: PipelineItem[], bags: PipelineBag[], banned: Set<string>) => MaybePromise<Assignment[]>;
  layer: (assignments: Assignment[], units: PackingUnit[], items: PipelineItem[], bags: PipelineBag[]) => MaybePromise<LayerResult>;
  fallback: typeof proposeFallback;
}
const defaults: PipelineStages = {
  identify: async () => { throw new Error('Identification stage is not configured. Inject agent.identify or a synthetic fixture; no implicit paid AI calls.'); },
  normalize: postprocessObjectCounts, tag: tag_capacity, capacity: capacity_from_dimensions, bundle: bundlePackingItems,
  detect: detectDimensions, measure: measureInstances, classify: classifyItem, preferences: preferItem,
  weight: estimateWeight, volume: estimateVolume, geometry: makePackingUnits,
  assign: (units, items, bags, banned) => plan_trip(units, items, bags, banned).assignments, layer: layerBags, fallback: proposeFallback,
};

function validateAssignments(assignments: Assignment[], units: PackingUnit[], items: PipelineItem[], bags: PipelineBag[], banned: Set<string>) {
  const seen = new Set<string>();
  for (const a of assignments) {
    const unit = units.find(u => u.id === a.unit_id);
    if (!unit || seen.has(a.unit_id) || !unit.allowedBagIds.includes(a.bag_id) || banned.has(`${a.unit_id}|${a.bag_id}`)) throw new Error('Assignment stage violated identity, eligibility, or retry constraints.');
    seen.add(a.unit_id);
  }
  for (const bag of bags) {
    const packed = assignments.filter(a => a.bag_id === bag.id).map(a => units.find(u => u.id === a.unit_id)!);
    if (packed.reduce((sum, u) => sum + unitMass(u, items), bag.emptyWeightKg) > bag.maxWeightKg + 1e-9
      || packed.reduce((sum, u) => sum + u.packedVolumeLiters, 0) > bag.capacityLiters + 1e-9) throw new Error('Assignment stage exceeded weight or volume.');
  }
}

/** Configure stages once; the callable has the requested three-argument API.
 * Upstream legacy normalization stays intact. Canonical records begin at its
 * finalized boundary; enrichment only adds fields, with raw counts retained.
 */
export function createPipeline(overrides: Partial<PipelineStages> = {}) {
  const stages = { ...defaults, ...overrides };
  return async function run_pipeline(image: PipelineImage, suitcase_dims: PipelineBag[], user_inputs: UserInputs = {}): Promise<PipelineResult> {
    validateObjectImage(image);
    // Private snapshots prevent plugins or downstream adapters modifying caller state.
    const bags = structuredClone(suitcase_dims), user = structuredClone(user_inputs);
    user.usePlaceholders ??= true;
    const reviewed = user.identityLedger ? projectLedger(user.identityLedger, image.photoId) : undefined;
    if (reviewed) {
      user.items = { ...user.items, ...reviewed.itemInputs };
      user.matches = { ...reviewed.matches, ...user.matches };
      user.changeOfClothesInstanceIds = reviewed.ledger.changeOfClothes;
    }
    if (bags.length !== 2 || bags.filter(b => b.kind === 'carry-on').length !== 1 || bags.filter(b => b.kind === 'checked').length !== 1
      || new Set(bags.map(b => b.id)).size !== bags.length) throw new Error('This integration expects one carry-on and one checked bag with distinct IDs.');
    for (const bag of bags) {
      if (!/^case-.+/.test(bag.id)) throw new Error('Bag IDs must be stable case- strings.');
      validateDims(bag.interiorIn); positive(bag.capacityLiters, 'Bag capacity'); positive(bag.maxWeightKg, 'Bag weight limit');
      if (!Number.isFinite(bag.emptyWeightKg) || bag.emptyWeightKg < 0 || bag.emptyWeightKg > bag.maxWeightKg) throw new Error('Invalid empty suitcase weight.');
    }
    const [raw, analysis] = await Promise.all([reviewed ? undefined : stages.identify(structuredClone(image)), stages.detect(structuredClone(image), structuredClone(bags), user)]);
    if (analysis) {
      const reference = bags.find(b => b.id === user.referenceBagId);
      if (!reference) throw new Error('Associate photoAnalysis with referenceBagId.');
      if (Math.abs(analysis.interior.lengthCm / 2.54 - reference.interiorIn.lengthIn) > 1e-6
        || Math.abs(analysis.interior.widthCm / 2.54 - reference.interiorIn.widthIn) > 1e-6) throw new Error('Calibration dimensions do not match the reference bag.');
    }
    // Confirmed instances are the source of truth. Regrouping never repeats AI
    // identification or count correction and never derives identity from labels.
    const normalized: DetectedObject[] = reviewed ? reviewed.groups.map(g => ({ label: g.label, count: g.count,
      attributes: g.attributes, flags: Object.values(g.attributes).includes(null) ? ['attribute_uncertain'] : [] })) : stages.normalize(raw);
    if (normalized.reduce((n, i) => n + i.count, 0) > 2000) throw new Error('Review counts: integration is limited to 2000 instances per image.');
    const ids = normalized.map((object, index) => reviewed?.groups[index].id ?? packingItemId(object));
    const capacities = new Map(normalized.map((object, index) => [ids[index], stages.capacity(object, analysis, user, ids[index])]));
    const tagged = normalized.map((object, index) => {
      const id = ids[index], tagged = stages.tag(object, user.items?.[id]?.baggage, capacities.get(id));
      return { ...tagged, id, flags: reviewed && object.label === 'shoes' && object.count > 5
        ? [...tagged.flags, 'shoe_count_correction_removed' as const] : tagged.flags };
    });
    // Prohibited items remain visible in the source list but never form packing
    // bundles. The unchanged F validator still checks every eligible member.
    const blocked = tagged.filter(item => item.placement_tag === 'prohibited');
    const inventory = stages.bundle(tagged.filter(item => item.placement_tag !== 'prohibited'));
    assertBundleInvariants(inventory);
    let items: PipelineItem[] = [...inventory.items, ...blocked].map(item => {
      const after = normalized[ids.indexOf(item.id)].count;
      const ai = reviewed?.groups.find(g => g.id === item.id)?.observedCount ?? (after > 5 ? after - 1 : after);
      return { ...item, ...(capacities.get(item.id) ? { container_capacity: capacities.get(item.id) } : {}), count_history: { ai_count: ai, after_margin: after, final_count: item.count },
        instances: reviewed?.instances.get(item.id) ?? Array.from({ length: item.count }, (_, i) => ({ id: `${item.id}:instance:${i + 1}`, item_id: item.id, origin: i < ai ? 'observed' : 'count_margin' })) };
    });
    const instanceIds = new Set(items.flatMap(i => i.instances.map(instance => instance.id)));
    for (const id of user.changeOfClothesInstanceIds ?? []) {
      if (!items.some(i => isGarment(i.label) && i.instances.some(instance => instance.id === id && instance.origin === 'observed'))) throw new Error('Change-of-clothes selection must identify real observed garments.');
    }
    const matchingIds = Object.values(user.matches ?? {});
    if (new Set(matchingIds).size !== matchingIds.length || matchingIds.some(id => !instanceIds.has(id))) throw new Error('Detection associations must reference distinct known instances.');
    for (const id of matchingIds) if (items.some(i => i.instances.some(instance => instance.id === id && instance.origin === 'count_margin'))) throw new Error('A synthetic count-margin instance cannot have pixels.');
    const issues: string[] = [], warnings: string[] = [
      'Integration proposal: category mapping and soft preference shortlist are provisional; no physical-fit guarantee.',
      'Layer adapter assumes ordinary handling; fragility and cleanliness need a future contract before applying to shared state.',
    ];
    if (analysis) {
      const unmatched = analysis.items.filter(d => !Object.hasOwn(user.matches ?? {}, d.id));
      if (unmatched.length) issues.push(`${unmatched.length} photo detections remain unmatched; review scene completeness.`);
    }
    items = await Promise.all(items.map(async item => {
      const [instances, classification, preferences, weight] = await Promise.all([
        stages.measure(structuredClone(item), analysis, user), stages.classify(structuredClone(item), user),
        stages.preferences(structuredClone(item), user), stages.weight(structuredClone(item), user),
      ]);
      if (instances.length !== item.count || instances.some((i, n) => i.id !== item.instances[n].id || i.item_id !== item.id || i.origin !== item.instances[n].origin)) throw new Error('Measurement stage changed instance identity or count.');
      instances.forEach(i => { if (i.dims) validateDims(i.dims.value); if (i.origin === 'count_margin' && (i.region || i.detection_id)) throw new Error('Margin instance cannot have image evidence.'); });
      if (weight) {
        positive(weight.unitKg, 'Unit mass'); positive(weight.totalKg, 'Entry mass');
        if (Math.abs(weight.totalKg - weight.unitKg * item.count) > 1e-9) throw new Error('Weight must be per-unit times final count, exactly once.');
        if (weight.review_required) {
          // Name the actual source: only placeholder and configured-ceiling masses are fallbacks.
          const kg = `${+weight.unitKg.toFixed(3)} kg each`;
          const origin = weight.source === 'placeholder' ? `placeholder mass (${kg}; no reference product for this label)`
            : weight.source === 'fallback_ceiling' ? `fallback mass (${kg}; configured ceiling)`
            : `reference product mass (${kg}; ${weight.source_urls?.join(', ') || 'catalog'})`;
          warnings.push(`${item.label} (${item.id}): ${origin} requires review. ${weight.limitation ?? ''}`.trim());
        }
      }
      const enriched = { ...item, instances, classification, preferences, weight, priority: user.items?.[item.id]?.priority ?? 'must_have' as const };
      if (classification && ![1, 2, 3].includes(classification.category)) throw new Error('Unknown packing category.');
      const volume = await stages.volume(structuredClone(enriched), user);
      if (volume) {
        positive(volume.uncompressedLiters, 'Uncompressed volume'); positive(volume.packedLiters, 'Packed volume');
        if (volume.packedLiters > volume.uncompressedLiters + 1e-9) throw new Error('Compression cannot increase volume.');
        warnings.push(...volume.warnings.map(w => `${item.id}: ${w}`));
      }
      return { ...enriched, volume };
    }));
    const geometry = await stages.geometry(structuredClone(items), structuredClone(inventory.bundles), structuredClone(bags), user);
    issues.push(...geometry.issues);
    const units = geometry.units;
    const unitIds = new Set<string>(), allocated = new Set<string>();
    for (const u of units) {
      if (unitIds.has(u.id) || !u.instance_ids.length) throw new Error('Duplicate/empty packing unit.');
      unitIds.add(u.id); validateDims(u.dimsIn); positive(u.packedVolumeLiters, 'Packed unit volume');
      for (const id of u.instance_ids) { if (!instanceIds.has(id) || allocated.has(id)) throw new Error('Packing units overlap or reference unknown instances.'); allocated.add(id); }
      // Liquid slack is a capacity reserve, deliberately separate from the
      // arrangement bbox. The old optimizer could not represent this contract.
      if (!u.flexible && u.packedVolumeLiters > liters(u.dimsIn) + 1e-9) throw new Error('Unit volume exceeds its packing envelope.');
      warnings.push(...(u.liquidPacking?.warnings ?? []).map(w => `${u.id}: ${w}`));
      const sources = items.filter(i => i.instances.some(instance => u.instance_ids.includes(instance.id)));
      if (sources.some(i => !i.weight || i.placement_tag === 'needs-review' || i.placement_tag === 'prohibited' || i.flags.includes('placement_review_required'))) throw new Error('Geometry stage bypassed missing mass or baggage review.');
      for (const id of u.allowedBagIds) {
        const bag = bags.find(b => b.id === id);
        if (!bag || sources.some(i => i.placement_tag === 'carry-on-only' && bag.kind !== 'carry-on' || i.placement_tag === 'checked-only' && bag.kind !== 'checked')) throw new Error('Geometry stage relaxed a hard placement constraint.');
      }
    }
    if (allocated.size < instanceIds.size && !issues.length) throw new Error('Geometry stage silently dropped instances.');
    const banned = new Set<string>(), reasons = new Map<string, string>();
    let layer: LayerResult = { placements: [], rejected: [], warnings: [] }, attempts = 0;
    // Every failed iteration excludes a previously allowed unit/bag edge.
    // At most 2 * units + 1 passes; no automatic wear/discard decisions.
    for (; attempts <= units.length * bags.length; ) {
      attempts++;
      const assignments = await stages.assign(structuredClone(units), structuredClone(items), structuredClone(bags), new Set(banned));
      validateAssignments(assignments, units, items, bags, banned);
      layer = await stages.layer(structuredClone(assignments), structuredClone(units), structuredClone(items), structuredClone(bags));
      const accounted = [...layer.placements, ...layer.rejected];
      if (accounted.length !== assignments.length || new Set(accounted.map(p => p.unit_id)).size !== assignments.length
        || accounted.some(p => !assignments.some(a => a.unit_id === p.unit_id && a.bag_id === p.bag_id))) throw new Error('Layer stage lost, duplicated, or reassigned a unit.');
      if (!layer.rejected.length) break;
      for (const rejected of layer.rejected) { banned.add(`${rejected.unit_id}|${rejected.bag_id}`); reasons.set(rejected.unit_id, rejected.reason); }
    }
    warnings.push(...layer.warnings);
    const packed = new Set(layer.placements.map(p => p.unit_id));
    const fallback = units.filter(u => !packed.has(u.id)).map(u => stages.fallback(u, reasons.get(u.id) ?? 'No eligible bag accepted this unit under the supplied dimensions, weight, and volume limits.', items, user));
    const placeholders = items.some(i => i.weight?.source === 'placeholder' || i.classification?.source === 'placeholder'
      || i.container_capacity?.source === 'placeholder' || i.instances.some(instance => instance.dims?.source === 'placeholder'));
    if (placeholders) warnings.push('ILLUSTRATIVE ONLY: placeholder dimensions, weight, category or container capacity were used. These are not measurements or travel clearance.');
    const identityLedger = reviewed?.ledger ?? importIdentifiedItems(items, image.photoId, undefined, {}, user.items);
    if (!reviewed) for (const physical of identityLedger.instances) {
      const observation = physical.observations.find(o => o.photo_id === image.photoId)!;
      const source = items.find(i => i.id === observation.source_item_id)!.instances[observation.source_ordinal - 1];
      if (source.detection_id) observation.detection_id = source.detection_id;
      if (source.region) observation.region = structuredClone(source.region);
      if (user.instanceDimsIn?.[source.id]) physical.facts.dimsIn = structuredClone(user.instanceDimsIn[source.id]);
    }
    return { status: issues.length ? 'needs_input' : placeholders ? 'illustrative' : 'proposal', items, bundles: inventory.bundles, units,
      identityLedger: projectLedger(identityLedger, image.photoId).ledger,
      placements: layer.placements, fallback, issues, warnings: [...new Set(warnings)], attempts,
      totalItemWeightKg: items.every(i => i.weight) ? items.reduce((sum, i) => sum + i.weight!.totalKg, 0) : null,
      ...(analysis && user.referenceBagId ? { calibration: { bag_id: user.referenceBagId, analysis } } : {}) };
  };
}

export const run_pipeline = createPipeline();
