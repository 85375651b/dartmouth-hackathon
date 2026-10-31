import { optimizePacking } from '../packing/optimize-packing.ts';
import { planAreas } from '../photo-packing/plan.ts';
import type { Analysis, Review } from '../photo-packing/types.ts';
import type { PackingBundle } from '../packing/bundles.ts';
import type { ItemId, PackWiseData, SuitcaseId } from '../types.ts';
import type { Assignment, Fallback, LayerResult, PackingUnit, PipelineBag, PipelineItem, UserInputs } from './contracts.ts';
import { CM_PER_IN, liters, toCm, validateDims } from './enrichment.ts';
import { packLiquids, type LiquidBundleResult } from './liquids-adapter.ts';

export async function makePackingUnits(items: PipelineItem[], bundles: PackingBundle[], bags: PipelineBag[], user: UserInputs): Promise<{ units: PackingUnit[]; issues: string[] }> {
  const units: PackingUnit[] = [], issues: string[] = [];
  const allocated = new Set<string>();
  async function add(id: string, instanceIds: string[], bundle?: PackingBundle) {
    const sources = items.filter(i => i.instances.some(instance => instanceIds.includes(instance.id)));
    const instances = sources.flatMap(i => i.instances.filter(instance => instanceIds.includes(instance.id)));
    if (!sources.every(i => i.weight && i.classification && i.volume) || instances.some(i => !i.dims)) {
      issues.push(`${id}: needs dimensions including height, weight, and a category for every member.`); return;
    }
    if (sources.some(i => i.placement_tag === 'needs-review' || i.placement_tag === 'prohibited' || i.flags.includes('placement_review_required'))) {
      issues.push(`${id}: unresolved or prohibited baggage placement; review before planning.`); return;
    }
    let dimsIn = instances[0].dims!.value;
    let geometry_source: PackingUnit['geometry_source'] = 'instance';
    let liquidPacking: LiquidBundleResult | undefined;
    if (bundle) {
      const measured = user.bundleDimsIn?.[bundle.bundle_id];
      if (measured) { dimsIn = validateDims(measured); geometry_source = 'user_bundle'; }
      else if (bundle.kind === 'shoe_pair') {
        // Identical shoes: L x (2W) x H. Unequal observed boxes: max L/H,
        // summed widths, the conservative extension without reshaping a shoe.
        dimsIn = {
          lengthIn: Math.max(...instances.map(i => i.dims!.value.lengthIn)),
          widthIn: instances.reduce((n, i) => n + i.dims!.value.widthIn, 0),
          heightIn: Math.max(...instances.map(i => i.dims!.value.heightIn)),
        };
        geometry_source = 'shoe_pair_width';
      } else {
        liquidPacking = await packLiquids(instances.map(instance => {
          const source = sources.find(i => i.id === instance.item_id)!;
          const facts = user.items?.[source.id];
          const d = toCm(instance.dims!.value);
          // ASSUMPTION: absent shape metadata uses a box; it never invents a
          // cylinder's lower material volume from a generic product label.
          return { item_id: instance.id, qty: 1, dims_cm: [d.lengthCm, d.widthCm, d.heightCm],
            shape: facts?.liquidShape ?? 'box', upright_only: facts?.uprightOnly ?? false, height_axis: facts?.heightAxis ?? 2 };
        }), user.liquidPacking);
        if (!liquidPacking.feasible) { issues.push(`${id}: liquid bundle search found no complete arrangement.`); return; }
        dimsIn = { lengthIn: liquidPacking.bbox_cm[0] / CM_PER_IN, widthIn: liquidPacking.bbox_cm[1] / CM_PER_IN, heightIn: liquidPacking.bbox_cm[2] / CM_PER_IN };
        geometry_source = 'liquid_search';
      }
    }
    const memberVolume = sources.reduce((sum, item) => sum + item.instances
      .filter(i => instanceIds.includes(i.id)).reduce((n, i) => n + liters(i.dims!.value), 0)
      * item.volume!.packedLiters / item.volume!.uncompressedLiters, 0);
    if (bundle && liters(dimsIn) + 1e-9 < memberVolume) { issues.push(`${id}: bundle box is smaller than estimated member volume; review measurements.`); return; }
    const allowedBagIds = bags.filter(bag => sources.every(i => i.placement_tag !== 'carry-on-only' || bag.kind === 'carry-on')
      && sources.every(i => i.placement_tag !== 'checked-only' || bag.kind === 'checked')).map(b => b.id);
    units.push({ id, ...(bundle ? { bundle_id: bundle.bundle_id } : {}), instance_ids: instanceIds,
      dimsIn: validateDims(dimsIn), packedVolumeLiters: liquidPacking ? liquidPacking.volume_cm3 / 1000 : bundle ? liters(dimsIn) : memberVolume, geometry_source,
      flexible: bundle?.kind === 'liquids', uprightOnly: sources.some(i => user.items?.[i.id]?.uprightOnly), ...(liquidPacking ? { liquidPacking } : {}),
      category: Math.min(...sources.map(i => i.classification!.category)) as 1 | 2 | 3,
      allowedBagIds, preferCarryOn: sources.some(i => i.preferences?.carry_on) || instanceIds.some(id => user.changeOfClothesInstanceIds?.includes(id)),
      preferOnTop: sources.some(i => i.preferences?.on_top) || instanceIds.some(id => user.changeOfClothesInstanceIds?.includes(id)),
      priority: sources.some(i => i.priority === 'must_have') ? 'must_have' : 'nice_to_have' });
  }
  for (const bundle of bundles) {
    const ids: string[] = [];
    for (const member of bundle.members) {
      const item = items.find(i => i.id === member.item_id)!;
      const selected = item.instances.filter(i => !allocated.has(i.id)).slice(0, member.qty);
      if (selected.length !== member.qty) throw new Error('Bundle instance allocation exceeds count.');
      selected.forEach(i => { allocated.add(i.id); ids.push(i.id); });
    }
    await add(bundle.bundle_id, ids, bundle);
  }
  for (const item of items) for (const instance of item.instances) if (!allocated.has(instance.id)) await add(instance.id, [instance.id]);
  return { units, issues };
}

/** Never store/add weight on bundles: derive member mass only at the planner boundary. */
export function unitMass(unit: PackingUnit, items: PipelineItem[]): number {
  return unit.instance_ids.reduce((sum, id) => {
    const item = items.find(i => i.instances.some(instance => instance.id === id));
    if (!item?.weight) throw new Error(`Missing mass source for ${id}.`);
    return sum + item.weight.unitKg;
  }, 0);
}
const legacyId = (id: string): ItemId => `item-unit-${id}`;

function legacyData(units: PackingUnit[], items: PipelineItem[], bags: PipelineBag[]): PackWiseData {
  return {
    trip: { id: 'trip-pipeline', name: 'Integration proposal', origin: '', destination: '', purpose: '', departureDate: '', durationDays: 1,
      itemIds: units.map(u => legacyId(u.id)), suitcaseIds: bags.map(b => b.id), roomZoneIds: [], isDemo: false },
    items: units.map(u => ({ id: legacyId(u.id), name: u.id, category: 'other', weightKg: unitMass(u, items), volumeLiters: u.packedVolumeLiters,
      dimensionsCm: toCm(u.dimsIn), quantity: 1, fragility: 'normal', carryOnRequired: false })),
    suitcases: bags.map(b => ({ id: b.id, name: b.id, kind: b.kind, emptyWeightKg: b.emptyWeightKg, maxWeightKg: b.maxWeightKg,
      capacityLiters: b.capacityLiters, dimensionsCm: toCm(b.interiorIn) })),
    roomZones: [], packingPlan: { id: 'pack-pipeline', tripId: 'trip-pipeline', assignments: [], unassignedItemIds: [] },
    unpackingPlan: { id: 'unpack-pipeline', tripId: 'trip-pipeline', packingPlanId: 'pack-pipeline', assignments: [], unassignedItemIds: [] },
  };
}

/** Compatibility wrapper, not a new optimizer. Call the existing greedy solver
 * on eligibility groups; it cannot express checked-only or priority itself. */
export function assignBags(units: PackingUnit[], items: PipelineItem[], bags: PipelineBag[], banned: Set<string>): Assignment[] {
  const assignments: Assignment[] = [];
  const used = new Map(bags.map(b => [b.id, { kg: 0, liters: 0 }]));
  const pending = new Set(units.map(u => u.id));
  function pass(candidates: PackingUnit[], preferred: boolean) {
    const groups = new Map<string, { ids: SuitcaseId[]; units: PackingUnit[] }>();
    for (const unit of candidates.filter(u => pending.has(u.id))) {
      const ids = unit.allowedBagIds.filter(id => !banned.has(`${unit.id}|${id}`) && (!preferred || bags.find(b => b.id === id)?.kind === 'carry-on')).sort();
      const key = JSON.stringify(ids);
      if (ids.length) { if (!groups.has(key)) groups.set(key, { ids, units: [] }); groups.get(key)!.units.push(unit); }
    }
    // Most constrained groups first. Existing solver retains its own within-group sort.
    for (const group of [...groups.values()].sort((a, b) => a.ids.length - b.ids.length || JSON.stringify(a.ids).localeCompare(JSON.stringify(b.ids)))) {
      const remaining = bags.filter(b => group.ids.includes(b.id)).map(b => ({ ...b,
        maxWeightKg: b.maxWeightKg - used.get(b.id)!.kg, capacityLiters: b.capacityLiters - used.get(b.id)!.liters,
      })).filter(b => b.maxWeightKg > b.emptyWeightKg && b.capacityLiters > 1e-9);
      if (!remaining.length) continue;
      const result = optimizePacking(legacyData(group.units, items, remaining));
      for (const assignment of result.packingPlan.assignments) {
        const unit = group.units.find(u => legacyId(u.id) === assignment.itemId)!;
        pending.delete(unit.id); assignments.push({ unit_id: unit.id, bag_id: assignment.suitcaseId });
        const load = used.get(assignment.suitcaseId)!; load.kg += unitMass(unit, items); load.liters += unit.packedVolumeLiters;
      }
    }
  }
  for (const priority of ['must_have', 'nice_to_have']) {
    const candidates = units.filter(u => u.priority === priority);
    // Reserve hard-constrained capacity before spending it on a soft preference.
    pass(candidates.filter(u => u.allowedBagIds.filter(id => !banned.has(`${u.id}|${id}`)).length === 1), false);
    pass(candidates.filter(u => u.preferCarryOn), true);
    pass(candidates, false);
  }
  return assignments;
}

/** Feed prepared rectangles to Anna's unchanged 2D layer solver. The adapter's
 * Analysis is explicitly virtual geometry; it is never exposed as photo evidence. */
export function layerBags(assignments: Assignment[], units: PackingUnit[], items: PipelineItem[], bags: PipelineBag[]): LayerResult {
  const result: LayerResult = { placements: [], rejected: [], warnings: [] };
  for (const bag of bags) {
    const selected = assignments.filter(a => a.bag_id === bag.id).map(a => units.find(u => u.id === a.unit_id)!);
    if (!selected.length) continue;
    const data = legacyData(selected, items, [bag]);
    const base = toCm(bag.interiorIn);
    const analysis: Analysis = {
      id: `virtual-prepared-rectangles:${bag.id}`, width: 1, height: 1, originalWidth: 1, originalHeight: 1,
      interior: { lengthCm: base.lengthCm, widthCm: base.widthCm }, suitcaseBoundary: [], suitcasePixelArea: 1,
      axisScale: { lengthCmPerPixel: 1, widthCmPerPixel: 1, cm2PerPixel: 1 }, transform: { h: [1, 0, 0, 0, 1, 0, 0, 0] },
      method: 'Adapter-only prepared rectangles; no camera measurements or pixel evidence.',
      items: selected.map((u, index) => {
        const d = toCm(u.dimsIn);
        return { id: u.id, number: index + 1, rawOutline: [], rectifiedOutline: [], rawPixelArea: 1,
          areaCm2: d.lengthCm * d.widthCm, envelope: { lengthCm: d.lengthCm, widthCm: d.widthCm, angle: 0 },
          suitcaseAreaRatio: d.lengthCm * d.widthCm / (base.lengthCm * base.widthCm), quality: 'Prepared rectangle, not an image detection.' };
      }),
    };
    const reviews: Review[] = selected.map(u => ({ id: u.id, name: u.id, category: u.category, confirmed: true, ignored: false, itemId: legacyId(u.id) }));
    const plan = planAreas(data, bag.id, analysis, reviews);
    result.rejected.push(...plan.unplaced.map(u => ({ unit_id: u.detectionId, bag_id: bag.id, reason: u.reason })));
    let height = 0, order = 0;
    for (const [index, layer] of plan.layers.entries()) {
      height += Math.max(...layer.placements.map(p => selected.find(u => u.id === p.detectionId)!.dimsIn.heightIn));
      for (const placement of layer.placements) {
        if (height > bag.interiorIn.heightIn + 1e-9) result.rejected.push({ unit_id: placement.detectionId, bag_id: bag.id, reason: 'Conservative sum of layer heights exceeds usable bag height.' });
        else result.placements.push({ unit_id: placement.detectionId, bag_id: bag.id, layer: index + 1, order: ++order,
          xIn: placement.x / CM_PER_IN, yIn: placement.y / CM_PER_IN, rotated: placement.rotated });
      }
    }
    for (const unit of selected.filter(u => u.preferOnTop)) {
      const placement = result.placements.find(p => p.unit_id === unit.id);
      if (placement && result.placements.some(p => p.bag_id === bag.id && p.order > placement.order)) result.warnings.push(`${unit.id}: top preference not guaranteed by the current category-based layer solver.`);
    }
  }
  return result;
}

export function proposeFallback(unit: PackingUnit, reason: string, items: PipelineItem[], user: UserInputs): Fallback {
  const sources = items.filter(i => i.instances.some(instance => unit.instance_ids.includes(instance.id)));
  const suggestions: Fallback['suggestions'] = ['revise_bags_or_measurements'];
  if (unit.allowedBagIds.length > 1) suggestions.push('move_to_other_bag');
  if (sources.every(i => user.items?.[i.id]?.canWear === true) && !sources.some(i => i.placement_tag === 'prohibited' || i.placement_tag === 'needs-review')) suggestions.push('wear_on_person');
  if (unit.priority === 'nice_to_have') suggestions.push('leave_at_home');
  return { unit_id: unit.id, reason, must_have: unit.priority === 'must_have', suggestions, requires_user_decision: true };
}
