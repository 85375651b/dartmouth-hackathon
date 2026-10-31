import test from 'node:test';
import assert from 'node:assert/strict';
import { editInstance, groupInstances, importIdentifiedItems, linkDetection, projectLedger, selectGarments, selectGarmentQuantity } from '../src/lib/pipeline/identity-ledger.ts';
import type { PackingInventoryItem } from '../src/lib/packing/bundles.ts';
import { createPipeline } from '../src/lib/pipeline/run-pipeline.ts';
import { syntheticInputs } from './fixtures/pipeline-synthetic.ts';
import { POST as preview } from '../src/app/api/packing-preview/route.ts';

const shirts: PackingInventoryItem = { id: 'item-shirts', label: 'shirt', count: 8, attributes: {}, flags: [], placement_tag: 'no-matching-rule' };
const shampoo: PackingInventoryItem = { id: 'item-shampoo', label: 'shampoo', count: 2, attributes: {}, flags: ['assumed_full'], placement_tag: 'needs-review' };

test('physical IDs survive edits, regrouping, reorder and same-photo reimport', () => {
  const original = importIdentifiedItems([shirts], 'photo-a');
  const ids = original.instances.map(i => i.id);
  const edited = editInstance(original, ids[0], { label: 'pants' });
  assert.deepEqual(edited.instances.map(i => i.id), ids);
  assert.equal(groupInstances(edited).groups.length, 2);
  const repeated = importIdentifiedItems([shirts], 'photo-a', edited);
  assert.equal(repeated.instances.length, 8);
  assert.equal(repeated.instances.find(i => i.id === ids[0])!.label, 'pants');
  const renamed = editInstance(edited, ids[0], { label: 'shorts' });
  assert.equal(groupInstances(edited).groups.find(g => g.label === 'pants')!.id, groupInstances(renamed).groups.find(g => g.label === 'shorts')!.id);
  assert.equal(original.instances[0].label, 'shirt');
  assert.deepEqual(groupInstances({ ...renamed, instances: [...renamed.instances].reverse() }).groups.map(g => g.id).sort(), groupInstances(renamed).groups.map(g => g.id).sort());
});

test('new-photo matching is explicit; fully matched photos reuse the synthetic count margin', () => {
  const ledger = importIdentifiedItems([shirts], 'photo-a');
  const links = Object.fromEntries(ledger.instances.filter(i => i.origin === 'observed').map(i => [`item-shirts:${i.observations[0].source_ordinal}`, i.id]));
  const matched = importIdentifiedItems([shirts], 'photo-b', ledger, links);
  assert.equal(matched.instances.length, 8);
  assert.ok(matched.instances.every(i => i.observations.length === 2));
  assert.equal(importIdentifiedItems([shirts], 'photo-c', ledger).instances.length, 16, 'No guessing physical identity from labels');
  assert.throws(() => importIdentifiedItems([shirts], 'photo-b', ledger, { 'item-shirts:1': ledger.instances[0].id, 'item-shirts:2': ledger.instances[0].id }), /twice/);
});

test('different facts form separate groups; exact/quantity outfit selection excludes margins and survives edits', () => {
  let ledger = importIdentifiedItems([shirts, shampoo], 'photo-a');
  const containers = ledger.instances.filter(i => i.label === 'shampoo');
  ledger = editInstance(ledger, containers[0].id, { facts: { baggage: { containerCapacityLiters: .05 }, unitWeightKg: .08 } });
  ledger = editInstance(ledger, containers[1].id, { facts: { baggage: { containerCapacityLiters: .25 }, unitWeightKg: .3 } });
  assert.equal(groupInstances(ledger).groups.filter(g => g.label === 'shampoo').length, 2);
  const group = groupInstances(ledger).groups.find(g => g.label === 'shirt')!;
  const selected = selectGarmentQuantity(ledger, group.id, 2);
  assert.equal(selected.changeOfClothes.length, 2);
  assert.ok(selected.changeOfClothes.every(id => selected.instances.find(i => i.id === id)!.origin === 'observed'));
  assert.throws(() => selectGarmentQuantity(ledger, group.id, 8), /available quantity/);
  assert.throws(() => selectGarments(ledger, [ledger.instances.find(i => i.origin === 'count_margin')!.id]), /real observed/);
  assert.throws(() => selectGarments(ledger, [containers[0].id]), /garments/);
  const renamed = editInstance(selected, selected.changeOfClothes[0], { label: 'pants' });
  assert.deepEqual(renamed.changeOfClothes, selected.changeOfClothes);
});

test('reviewed detection links cannot claim margins or two different objects', () => {
  const ledger = importIdentifiedItems([shirts], 'photo-a');
  const linked = linkDetection(ledger, ledger.instances[0].id, 'photo-a', 'detection-1');
  assert.equal(projectLedger(linked, 'photo-a').matches['detection-1'], ledger.instances[0].id);
  assert.throws(() => linkDetection(linked, ledger.instances[1].id, 'photo-a', 'detection-1'), /already belongs/);
  assert.throws(() => linkDetection(ledger, ledger.instances.at(-1)!.id, 'photo-a', 'detection-2'), /Only real/);
});

test('reviewed pipeline bypasses AI/count correction, preserves IDs, tags individual capacities and selects only chosen garments', async () => {
  let ledger = importIdentifiedItems([shirts, shampoo], 'photo-a');
  const containers = ledger.instances.filter(i => i.label === 'shampoo');
  ledger = editInstance(ledger, containers[0].id, { facts: { baggage: { containerCapacityLiters: .05 } } });
  ledger = editInstance(ledger, containers[1].id, { facts: { baggage: { containerCapacityLiters: .25 } } });
  ledger = selectGarmentQuantity(ledger, groupInstances(ledger).groups.find(g => g.label === 'shirt')!.id, 1);
  const { image, bags } = syntheticInputs(); delete image.raster; image.photoId = 'photo-a';
  const pipeline = createPipeline({ identify: async () => { assert.fail('Reviewed inventory must not call AI'); }, normalize: () => { assert.fail('Do not apply +1 twice'); } });
  const result = await pipeline(image, bags, { identityLedger: ledger });
  assert.equal(result.status, 'illustrative');
  assert.equal(result.items.find(i => i.label === 'shirt')!.count, 8);
  assert.equal(result.items.filter(i => i.label === 'shampoo').length, 2);
  assert.deepEqual(result.items.filter(i => i.label === 'shampoo').map(i => i.placement_tag).sort(), ['checked-only', 'no-matching-rule']);
  assert.deepEqual(result.items.flatMap(i => i.instances.map(instance => instance.id)).sort(), ledger.instances.map(i => i.id).sort());
  const shirtUnits = result.units.filter(u => u.instance_ids.some(id => ledger.instances.find(i => i.id === id)!.label === 'shirt'));
  assert.equal(shirtUnits.filter(u => u.preferCarryOn).length, 1);
  assert.ok(shirtUnits.find(u => u.preferCarryOn)!.instance_ids.includes(ledger.changeOfClothes[0]));
  assert.ok(result.items.every(i => i.instances.every(instance => instance.dims?.source === 'placeholder' || instance.origin === 'count_margin')));
  const again = await pipeline(image, bags, { identityLedger: result.identityLedger });
  assert.deepEqual(again.items.map(i => i.id), result.items.map(i => i.id));
  assert.equal(again.items.reduce((sum, i) => sum + i.count, 0), 10);
});

test('preview endpoint plans the ledger locally with no credential or AI dependency', async () => {
  const ledger = importIdentifiedItems([shirts], 'photo-a');
  const { bags } = syntheticInputs();
  const response = await preview(new Request('http://localhost/api/packing-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ledger, bags, photoId: 'photo-a' }) }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.status, 'illustrative'); assert.equal(data.items[0].count, 8);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
