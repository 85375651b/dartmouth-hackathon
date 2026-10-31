import type { Assignment, PackingUnit, PipelineBag, PipelineItem } from './contracts.ts';

export interface TripPlan {
  assignments: Assignment[];
  unassigned: { unit_id: string; failures: { bag_id: string; reasons: string[] }[] }[];
}

function mass(unit: PackingUnit, items: PipelineItem[]) {
  return unit.instance_ids.reduce((sum, id) => {
    const item = items.find(i => i.instances.some(instance => instance.id === id));
    if (!item?.weight) throw new Error(`Missing source weight for ${id}.`);
    return sum + item.weight.unitKg;
  }, 0);
}

function fits(unit: PackingUnit, bag: PipelineBag) {
  const a = unit.dimsIn, b = bag.interiorIn;
  const sizes = unit.uprightOnly ? [[a.lengthIn, a.widthIn, a.heightIn], [a.widthIn, a.lengthIn, a.heightIn]]
    : [[a.lengthIn, a.widthIn, a.heightIn], [a.widthIn, a.lengthIn, a.heightIn], [a.heightIn, a.widthIn, a.lengthIn],
      [a.widthIn, a.heightIn, a.lengthIn], [a.lengthIn, a.heightIn, a.widthIn], [a.heightIn, a.lengthIn, a.widthIn]];
  return sizes.some(s => s[0] <= b.lengthIn + 1e-9 && s[1] <= b.widthIn + 1e-9 && s[2] <= b.heightIn + 1e-9);
}

/** Deterministic first-fit-decreasing assignment, separate from Anna's layers.
 * Hard eligibility and budgets gate every choice. Must-have precedes optional;
 * constrained entries precede flexible entries; cabin preference is a soft tie
 * breaker. No item/bundle mass is invented and no user item is discarded.
 */
export function plan_trip(units: PackingUnit[], items: PipelineItem[], bags: PipelineBag[], banned: Set<string> = new Set()): TripPlan {
  const positive = (n: number) => Number.isFinite(n) && n > 0;
  for (const bag of bags) if (!bag.id || !['carry-on', 'checked'].includes(bag.kind)
    || ![bag.interiorIn.lengthIn, bag.interiorIn.widthIn, bag.interiorIn.heightIn, bag.maxWeightKg, bag.capacityLiters].every(positive)
    || !Number.isFinite(bag.emptyWeightKg) || bag.emptyWeightKg < 0 || bag.emptyWeightKg > bag.maxWeightKg) throw new Error('Invalid suitcase dimensions or limits.');
  for (const unit of units) if (!unit.id || !unit.instance_ids.length
    || ![unit.dimsIn.lengthIn, unit.dimsIn.widthIn, unit.dimsIn.heightIn, unit.packedVolumeLiters].every(positive)
    || !['must_have', 'nice_to_have'].includes(unit.priority)) throw new Error('Invalid packing unit geometry or priority.');
  const instanceIds = items.flatMap(i => i.instances.map(instance => instance.id));
  if (new Set(items.map(i => i.id)).size !== items.length || new Set(instanceIds).size !== instanceIds.length) throw new Error('Source item/instance IDs must be unique.');
  const used = new Map(bags.map(b => [b.id, { kg: b.emptyWeightKg, liters: 0 }]));
  if (used.size !== bags.length || new Set(units.map(u => u.id)).size !== units.length) throw new Error('Duplicate bag or packing-unit IDs.');
  const claimed = new Set<string>();
  for (const unit of units) for (const id of unit.instance_ids) {
    if (claimed.has(id)) throw new Error('Packing units claim the same instance twice.');
    claimed.add(id);
  }
  const unitMass = new Map(units.map(u => [u.id, mass(u, items)]));
  if ([...unitMass.values()].some(kg => !positive(kg))) throw new Error('Unit mass must be positive and finite.');
  function failures(unit: PackingUnit, bag: PipelineBag, empty = false): string[] {
    const reasons: string[] = [];
    const sources = items.filter(i => i.instances.some(instance => unit.instance_ids.includes(instance.id)));
    if (!unit.allowedBagIds.includes(bag.id) || sources.some(i => i.placement_tag === 'prohibited' || i.placement_tag === 'needs-review'
      || i.flags.includes('placement_review_required') || i.placement_tag === 'carry-on-only' && bag.kind !== 'carry-on'
      || i.placement_tag === 'checked-only' && bag.kind !== 'checked')) reasons.push('placement');
    if (banned.has(`${unit.id}|${bag.id}`)) reasons.push('previous_layer_failure');
    if (!fits(unit, bag)) reasons.push('dimensions');
    const load = empty ? { kg: bag.emptyWeightKg, liters: 0 } : used.get(bag.id)!;
    if (load.kg + unitMass.get(unit.id)! > bag.maxWeightKg + 1e-9) reasons.push('weight');
    if (load.liters + unit.packedVolumeLiters > bag.capacityLiters + 1e-9) reasons.push('volume');
    return reasons;
  }
  const possible = new Map(units.map(u => [u.id, bags.filter(b => !failures(u, b, true).length).length]));
  const ordered = [...units].sort((a, b) => Number(b.priority === 'must_have') - Number(a.priority === 'must_have')
    || possible.get(a.id)! - possible.get(b.id)! || b.packedVolumeLiters - a.packedVolumeLiters
    || unitMass.get(b.id)! - unitMass.get(a.id)! || a.id.localeCompare(b.id));
  const assignments: Assignment[] = [], unassigned: TripPlan['unassigned'] = [];
  for (const unit of ordered) {
    const candidates = bags.filter(b => !failures(unit, b).length).sort((a, b) => {
      const preferred = (bag: PipelineBag) => unit.preferCarryOn ? bag.kind === 'carry-on' : bag.kind === 'checked';
      return Number(preferred(b)) - Number(preferred(a)) || a.id.localeCompare(b.id);
    });
    const target = candidates[0];
    if (!target) { unassigned.push({ unit_id: unit.id, failures: bags.map(b => ({ bag_id: b.id, reasons: failures(unit, b) })) }); continue; }
    const load = used.get(target.id)!;
    load.kg += unitMass.get(unit.id)!; load.liters += unit.packedVolumeLiters;
    assignments.push({ unit_id: unit.id, bag_id: target.id });
  }
  return { assignments, unassigned };
}
