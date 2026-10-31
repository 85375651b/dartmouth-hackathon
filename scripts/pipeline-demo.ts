import { runSynthetic } from './fixtures/pipeline-synthetic.ts';
const result = await runSynthetic();
console.log(JSON.stringify({
  fixture: 'SYNTHETIC: stub identification; real detector, tagging, bundles, compression arithmetic, optimizer, and layer solver',
  status: result.status,
  items: result.items.map(i => ({ id: i.id, label: i.label, counts: i.count_history, flags: i.flags, placement_tag: i.placement_tag, category: i.classification?.category,
    weightKg: i.weight?.totalKg, volume: i.volume, pixelInstances: i.instances.filter(i => i.region).length })),
  bundles: result.bundles,
  packingUnits: result.units,
  placements: result.placements,
  fallback: result.fallback,
  totalItemWeightKg: result.totalItemWeightKg,
  attempts: result.attempts, issues: result.issues, warnings: result.warnings,
}, null, 2));
