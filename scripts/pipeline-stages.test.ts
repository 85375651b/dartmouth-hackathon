import test from 'node:test';
import assert from 'node:assert/strict';
import { estimate_weight, type WeightReference } from '../src/lib/pipeline/weight-estimator.ts';
import { plan_trip } from '../src/lib/pipeline/plan-trip.ts';
import { packLiquids } from '../src/lib/pipeline/liquids-adapter.ts';
import { estimate_container_capacity, tag_capacity } from '../src/lib/pipeline/container-capacity.ts';
import { idFor, syntheticInputs, syntheticPipeline } from './fixtures/pipeline-synthetic.ts';
import type { PackingUnit, PipelineItem } from '../src/lib/pipeline/contracts.ts';

function item(label = 'laptop', count = 2): PipelineItem {
  return { id: 'item-example', label, count, attributes: { type: 'ultrabook_thin_light' }, flags: [], placement_tag: 'no-matching-rule',
    count_history: { ai_count: count, after_margin: count, final_count: count },
    instances: Array.from({ length: count }, (_, i) => ({ id: `item-example:instance:${i + 1}`, item_id: 'item-example', origin: 'observed' })),
  };
}
const references: WeightReference[] = [
  { id: 'thin-1', label: 'laptop', attributes: { type: 'ultrabook_thin_light' }, unitKg: 1, state: 'not_applicable', sourceUrl: 'https://example.invalid/thin', checkedOn: '2026-10-31' },
  { id: 'thin-2', label: 'laptop', attributes: { type: 'ultrabook_thin_light' }, unitKg: 1.3, state: 'not_applicable', sourceUrl: 'https://example.invalid/thin2', checkedOn: '2026-10-31' },
  { id: 'gaming', label: 'laptop', attributes: { type: 'gaming_or_workstation' }, unitKg: 3, state: 'not_applicable', sourceUrl: 'https://example.invalid/gaming', checkedOn: '2026-10-31' },
];

test('weight uses attribute maximum, category fallback, primitive quantities and source provenance', () => {
  const source = item(), before = structuredClone(source);
  const weight = estimate_weight(source, { weightReferences: references })!;
  assert.equal(weight.unitKg, 1.3); assert.equal(weight.totalKg, 2.6);
  assert.equal(weight.source, 'catalog_attribute_max'); assert.deepEqual(weight.reference_ids, ['thin-2']);
  const uncertain = estimate_weight({ ...source, attributes: { type: null }, flags: ['attribute_uncertain'] }, { weightReferences: references })!;
  assert.equal(uncertain.unitKg, 3); assert.equal(uncertain.source, 'catalog_category_max'); assert.equal(uncertain.review_required, true);
  assert.equal(estimate_weight({ ...source, label: 'unknown object' }, { weightReferences: references }), undefined);
  assert.deepEqual(source, before);
  assert.equal(estimate_weight(source, { items: { [source.id]: { unitWeightKg: .9 } } })!.totalKg, 1.8);
  assert.throws(() => estimate_weight(source, { weightReferences: [...references, references[0]] }), /unique/);
});

test('empty vessels never use full-product weights, and power bank ceiling has no capacity attribute', () => {
  const bottle = { ...item('water bottle', 1), attributes: { material: 'steel' as const }, flags: ['assumed_empty' as const] };
  assert.equal(estimate_weight(bottle)?.source, 'catalog_attribute_max');
  assert.equal(estimate_weight({ ...bottle, flags: ['assumed_full'] }), undefined);
  const power = estimate_weight({ ...item('power bank', 5), attributes: {} })!;
  assert.equal(power.unitKg, .595); assert.equal(power.totalKg, .595 * 5);
});

test('capacity estimates preserve uncertainty, explicit maximum prohibits, rated large liquids stay checked-only', () => {
  const estimated = estimate_container_capacity([5, 5, 10], 'box');
  assert.deepEqual(estimated, { capacityLiters: .25, source: 'dimensions_estimate' });
  assert.ok(Math.abs(estimate_container_capacity([4, 4, 10], 'cylinder').capacityLiters - Math.PI * 40 / 1000) < 1e-12);
  const liquid = { label: 'lotion', count: 1, attributes: {}, flags: [] };
  assert.equal(tag_capacity(liquid, {}, estimated).placement_tag, 'needs-review');
  assert.equal(tag_capacity(liquid, {}, { ...estimated, maximumLiters: .2 }).placement_tag, 'prohibited');
  assert.equal(tag_capacity(liquid, {}, { ...estimated, source: 'rated' }).placement_tag, 'checked-only');
  const bottle = { label: 'water bottle', count: 1, attributes: { material: 'steel' as const }, flags: [] };
  assert.equal(tag_capacity(bottle, {}, { ...estimated, maximumLiters: .1 }).placement_tag, 'no-matching-rule');
  assert.throws(() => estimate_container_capacity([5, 5], 'box'), /three/);
});

test('prohibited capacity stays visible, unbundled and unassigned in the whole workflow', async () => {
  const { image, bags, user } = syntheticInputs();
  user.containerCapacities = { [idFor('lotion')]: { capacityLiters: .25, maximumLiters: .2, source: 'rated' } };
  const result = await syntheticPipeline(image, bags, user);
  assert.equal(result.status, 'needs_input');
  assert.equal(result.items.find(i => i.label === 'lotion')?.placement_tag, 'prohibited');
  assert.ok(!result.bundles.some(b => b.bundle_id === 'liquids_checked'));
  assert.ok(result.issues.some(i => i.includes('prohibited')));
});

test('liquid bridge returns arrangement, and pipeline uses shoe width, liquid slack, flexibility, and catalog weight', async () => {
  const packed = await packLiquids([{ item_id: 'one', qty: 1, dims_cm: [3, 4, 5], shape: 'box' }]);
  assert.deepEqual(packed.bbox_cm, [3, 4, 5]); assert.equal(packed.volume_cm3, 69); assert.equal(packed.flexible, true);
  const { image, bags, user } = syntheticInputs();
  delete user.items![idFor('power bank')].unitWeightKg;
  const result = await syntheticPipeline(image, bags, user);
  const shoes = result.units.find(u => u.bundle_id?.startsWith('shoe_pair'))!;
  const shoeDims = result.items.find(i => i.label === 'shoes')!.instances[0].dims!.value;
  assert.ok(Math.abs(shoes.dimsIn.lengthIn - shoeDims.lengthIn) < 1e-9);
  assert.ok(Math.abs(shoes.dimsIn.widthIn - shoeDims.widthIn * 2) < 1e-9);
  assert.equal(shoes.dimsIn.heightIn, shoeDims.heightIn);
  const liquids = result.units.find(u => u.id === 'liquids_checked')!;
  assert.equal(liquids.flexible, true); assert.equal(liquids.geometry_source, 'liquid_search');
  assert.equal(liquids.packedVolumeLiters, liquids.liquidPacking!.volume_cm3 / 1000);
  assert.equal(result.items.find(i => i.label === 'power bank')?.weight?.source, 'catalog_category_max');
});

test('plan_trip accepts flexible slack, enforces hard tags/upright orientation and explains failed bag attempts', () => {
  const { bags } = syntheticInputs();
  const source = item('power bank', 1); source.attributes = {}; source.placement_tag = 'carry-on-only';
  source.weight = { unitKg: 1, totalKg: 1, source: 'user', review_required: false };
  const unit: PackingUnit = { id: 'unit-one', instance_ids: [source.instances[0].id], dimsIn: { lengthIn: 1, widthIn: 1, heightIn: 1 },
    packedVolumeLiters: .03, flexible: true, geometry_source: 'liquid_search', category: 1, allowedBagIds: bags.map(b => b.id),
    preferCarryOn: false, preferOnTop: false, priority: 'must_have' };
  assert.equal(plan_trip([unit], [source], bags).assignments[0].bag_id, 'case-cabin');
  const failed = plan_trip([unit], [source], bags, new Set(['unit-one|case-cabin']));
  assert.equal(failed.assignments.length, 0); assert.ok(failed.unassigned[0].failures.every(f => f.reasons.length));
  source.placement_tag = 'no-matching-rule';
  const tall = { ...unit, uprightOnly: true, dimsIn: { lengthIn: 1, widthIn: 1, heightIn: 16 } };
  assert.equal(plan_trip([tall], [source], bags).unassigned.length, 1);
  assert.equal(plan_trip([{ ...tall, uprightOnly: false }], [source], bags).assignments.length, 1);
  assert.throws(() => plan_trip([unit, { ...unit, id: 'other' }], [source], bags), /same instance/);
  assert.throws(() => plan_trip([{ ...unit, packedVolumeLiters: NaN }], [source], bags), /geometry/);
});
