import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipeline } from '../src/lib/pipeline/run-pipeline.ts';
import { layerBags, unitMass } from '../src/lib/pipeline/packing-adapters.ts';
import { toCm, liters } from '../src/lib/pipeline/enrichment.ts';
import { idFor, rawObjects, runSynthetic, syntheticInputs, syntheticPipeline } from './fixtures/pipeline-synthetic.ts';

test('end-to-end: real geometry and legacy stages join without losing identity, quantities, or hard tags', async () => {
  const result = await runSynthetic();
  assert.equal(result.status, 'proposal'); assert.deepEqual(result.issues, []);
  assert.equal(result.items.length, 7); assert.equal(result.items.some(i => i.label === 'suitcase'), false);
  const shirts = result.items.find(i => i.label === 'shirt')!;
  assert.deepEqual(shirts.count_history, { ai_count: 7, after_margin: 8, final_count: 8 });
  assert.equal(shirts.instances.filter(i => i.region).length, 7);
  const margin = shirts.instances.at(-1)!;
  assert.equal(margin.origin, 'count_margin'); assert.equal(margin.region, undefined); assert.equal(margin.dims?.source, 'margin_max_envelope');
  assert.equal(shirts.weight!.totalKg, 1.6);
  const shoes = result.items.find(i => i.label === 'shoes')!;
  assert.equal(shoes.count, 3); assert.ok(shoes.flags.includes('unpaired_shoe'));
  assert.equal(result.bundles.filter(b => b.kind === 'shoe_pair').length, 1);
  assert.ok(result.units.some(u => u.id === `${shoes.id}:instance:3`));
  assert.deepEqual(result.bundles.filter(b => b.kind === 'liquids').map(b => [b.bundle_id, b.members.length]), [['liquids_cabin', 1], ['liquids_checked', 1]]);
  assert.equal(result.placements.find(p => p.unit_id === 'liquids_checked')?.bag_id, 'case-checked');
  assert.equal(result.placements.find(p => p.unit_id === `${idFor('power bank')}:instance:1`)?.bag_id, 'case-cabin');
  const puffer = result.items.find(i => i.label === 'jacket')!;
  assert.equal(puffer.classification!.category, 3); assert.equal(puffer.volume!.packedLiters, puffer.volume!.uncompressedLiters / 2);
  assert.equal(result.fallback.length, 1); assert.equal(result.fallback[0].unit_id, `${idFor('surfboard')}:instance:1`);
  assert.ok(result.fallback[0].suggestions.includes('leave_at_home'));
  assert.ok(Math.abs(result.totalItemWeightKg! - 9.03) < 1e-9);
  assert.ok(Math.abs(result.units.reduce((sum, u) => sum + unitMass(u, result.items), 0) - result.totalItemWeightKg!) < 1e-9);
  assert.equal(new Set(result.units.flatMap(u => u.instance_ids)).size, result.items.reduce((sum, i) => sum + i.count, 0));
  assert.ok(result.bundles.every(b => !('weightKg' in b) && !('mass' in b)));
});

test('missing mass/height/materials are explicit; fallback requires a configured ceiling', async () => {
  const { image, bags, user } = syntheticInputs();
  user.weightReferences = []; // Explicitly test a category absent from the catalog.
  delete user.items![idFor('power bank')].unitWeightKg;
  const blocked = await syntheticPipeline(image, bags, user);
  assert.equal(blocked.status, 'needs_input'); assert.equal(blocked.totalItemWeightKg, null);
  assert.ok(!blocked.units.some(u => u.id.startsWith(idFor('power bank'))));
  user.fallbackUnitWeightKg = 1;
  const fallback = await syntheticPipeline(image, bags, user);
  assert.equal(fallback.items.find(i => i.label === 'power bank')?.weight?.source, 'fallback_ceiling');
  assert.ok(fallback.warnings.some(w => w.includes('fallback mass')));
  delete user.items![idFor('shirt')].heightIn;
  assert.equal((await syntheticPipeline(image, bags, user)).status, 'needs_input');
});

test('bounded retry replans a rejected unit in the other eligible bag', async () => {
  const { image, bags, user } = syntheticInputs(); let rejectedOnce = false;
  const pipeline = createPipeline({ identify: async () => rawObjects, layer: (assignments, units, items, bags) => {
    const result = layerBags(assignments, units, items, bags);
    if (!rejectedOnce) {
      const target = result.placements.find(p => p.unit_id.startsWith(idFor('shirt')))!;
      rejectedOnce = true;
      result.placements = result.placements.filter(p => p.unit_id !== target.unit_id);
      result.rejected.push({ ...target, reason: 'Synthetic layering failure to exercise retry.' });
    }
    return result;
  } });
  const result = await pipeline(image, bags, user);
  assert.equal(result.attempts, 2);
  assert.ok(result.placements.some(p => p.unit_id.startsWith(idFor('shirt')) && p.bag_id === 'case-cabin'));
});

test('units convert once; count-margin pixels and bad plugin assignments fail closed', async () => {
  assert.deepEqual(toCm({ lengthIn: 10, widthIn: 5, heightIn: 2 }), { lengthCm: 25.4, widthCm: 12.7, heightCm: 5.08 });
  assert.equal(liters({ lengthIn: 1, widthIn: 1, heightIn: 1 }), .016387064);
  const { image, bags, user } = syntheticInputs();
  const original = structuredClone(user);
  await syntheticPipeline(image, bags, user); assert.deepEqual(user, original);
  user.matches!['synthetic-photo-object-1'] = `${idFor('shirt')}:instance:8`;
  await assert.rejects(syntheticPipeline(image, bags, user), /synthetic count-margin/);
  const invalid = createPipeline({ identify: async () => rawObjects, assign: () => [{ unit_id: `${idFor('power bank')}:instance:1`, bag_id: 'case-checked' }] });
  await assert.rejects(invalid(image, bags, original), /eligibility/);
});

test('unknown liquid capacity remains blocked while known bundle geometry is computed', async () => {
  const { image, bags, user } = syntheticInputs();
  delete user.items![idFor('shampoo')].baggage;
  user.acceptConservativeBundleEnvelope = false;
  const result = await syntheticPipeline(image, bags, user);
  assert.equal(result.status, 'needs_input');
  assert.ok(result.issues.some(i => i.includes('unresolved')));
  assert.ok(result.units.some(u => u.geometry_source === 'shoe_pair_width'));
  assert.ok(result.units.some(u => u.id === 'liquids_checked' && u.geometry_source === 'liquid_search'));
  assert.ok(!result.placements.some(p => p.unit_id === 'liquids_cabin'));
});

test('real height overflow triggers reassignment; must-have fallback never suggests leaving it', async () => {
  const { image, bags } = syntheticInputs(); delete image.raster;
  const raw = [{ label: 'book', count: 2, attributes: {}, flags: [] }];
  const { packingItemId } = await import('../src/lib/packing/bundles.ts');
  const id = packingItemId(raw[0]);
  const pipeline = createPipeline({ identify: async () => raw });
  const small = bags.map(b => ({ ...b, interiorIn: { lengthIn: 12, widthIn: 12, heightIn: 6 }, capacityLiters: 30 }));
  const user = { items: { [id]: { dimsIn: { lengthIn: 12, widthIn: 12, heightIn: 4 }, unitWeightKg: 1 } } };
  const result = await pipeline(image, small, user);
  assert.equal(result.attempts, 2);
  assert.equal(result.placements.length, 2); assert.equal(new Set(result.placements.map(p => p.bag_id)).size, 2);
  const huge = await pipeline(image, small, { items: { [id]: { dimsIn: { lengthIn: 100, widthIn: 100, heightIn: 100 }, unitWeightKg: 1 } } });
  assert.equal(huge.fallback.length, 2); assert.ok(huge.fallback.every(f => f.must_have && !f.suggestions.includes('leave_at_home')));
});

test('different instance dimensions retain their own volume and seven shoes retain provenance', async () => {
  const { image, bags } = syntheticInputs(); delete image.raster;
  const shoe = rawObjects.find(o => o.label === 'shoes')!;
  const pipeline = createPipeline({ identify: async () => [{ ...shoe, count: 7 }] });
  const id = idFor('shoes');
  const result = await pipeline(image, bags, { acceptConservativeBundleEnvelope: true,
    items: { [id]: { dimsIn: { lengthIn: 4, widthIn: 2, heightIn: 2 }, unitWeightKg: .4 } },
    instanceDimsIn: { [`${id}:instance:7`]: { lengthIn: 1, widthIn: 1, heightIn: 1 } },
  });
  assert.deepEqual(result.items[0].count_history, { ai_count: 7, after_margin: 8, final_count: 7 });
  assert.equal(result.bundles.length, 3);
  assert.ok(Math.abs(result.units.find(u => u.id === `${id}:instance:7`)!.packedVolumeLiters - .016387064) < 1e-9);
});

test('soft cabin preferences do not consume capacity reserved for hard cabin-only items', async () => {
  const { image, bags } = syntheticInputs(); delete image.raster;
  const laptop = { label: 'laptop', count: 1, attributes: { type: 'ultrabook_thin_light' as const }, flags: [] };
  const powerBank = rawObjects.find(o => o.label === 'power bank')!;
  const { packingItemId } = await import('../src/lib/packing/bundles.ts');
  bags[0].maxWeightKg = bags[0].emptyWeightKg + 1;
  const pipeline = createPipeline({ identify: async () => [laptop, powerBank] });
  const input = { dimsIn: { lengthIn: 2, widthIn: 2, heightIn: 1 }, unitWeightKg: 1 };
  const result = await pipeline(image, bags, { items: { [packingItemId(laptop)]: input, [packingItemId(powerBank)]: input } });
  assert.equal(result.fallback.length, 0);
  assert.equal(result.placements.find(p => p.unit_id.startsWith(packingItemId(powerBank)))?.bag_id, 'case-cabin');
  assert.equal(result.placements.find(p => p.unit_id.startsWith(packingItemId(laptop)))?.bag_id, 'case-checked');
});
