import type { PipelineItem, UserInputs } from './contracts.ts';

export interface WeightReference {
  id: string; label: string; attributes: Record<string, string>;
  /** One primitive: one shoe, an empty drinking bottle, a full liquid product. */
  unitKg: number; state: 'empty' | 'full' | 'not_applicable';
  sourceUrl: string; checkedOn: string;
}

/** Small, explicitly incomplete catalog. These are source examples, NEVER
 * identified brands/models or claimed maxima across all products in the world.
 * ASSUMPTION: ceiling means maximum of the provided category reference set.
 */
export const DEFAULT_WEIGHT_REFERENCES: readonly WeightReference[] = [
  { id: 'weight-air-m4', label: 'laptop', attributes: { type: 'ultrabook_thin_light' }, unitKg: 1.24, state: 'not_applicable', sourceUrl: 'https://support.apple.com/en-au/122209', checkedOn: '2026-10-31' },
  { id: 'weight-pro-m4max', label: 'laptop', attributes: { type: 'gaming_or_workstation' }, unitKg: 2.15, state: 'not_applicable', sourceUrl: 'https://support.apple.com/en-ie/121554', checkedOn: '2026-10-31' },
  { id: 'weight-anker-a1695', label: 'power bank', attributes: {}, unitKg: .595, state: 'not_applicable', sourceUrl: 'https://www.anker.com/products/a1695-anker-power-bank-25000mah-165w', checkedOn: '2026-10-31' },
  { id: 'weight-hydroflask-32', label: 'water bottle', attributes: { material: 'steel' }, unitKg: .97 * .45359237, state: 'empty', sourceUrl: 'https://www.hydroflask.com/32-oz-wide-mouth?color=Oat', checkedOn: '2026-10-31' },
  { id: 'weight-patagonia-down', label: 'jacket', attributes: { type: 'down_puffer' }, unitKg: .369, state: 'not_applicable', sourceUrl: 'https://www.patagonia.com/product/mens-down-sweater-insulated-jacket/84675.html', checkedOn: '2026-10-31' },
];

export function estimate_weight(item: PipelineItem, user: UserInputs = {}): PipelineItem['weight'] {
  if (!Number.isSafeInteger(item.count) || item.count < 1) throw new Error('Weight estimation requires a positive integer count.');
  const manual = user.items?.[item.id]?.unitWeightKg;
  function result(unitKg: number, source: NonNullable<PipelineItem['weight']>['source'], references: WeightReference[] = []): NonNullable<PipelineItem['weight']> {
    if (!Number.isFinite(unitKg) || unitKg <= 0 || !Number.isFinite(unitKg * item.count)) throw new Error(`Invalid weight for ${item.id}.`);
    return { unitKg, totalKg: unitKg * item.count, source, review_required: source !== 'user',
      reference_ids: references.map(r => r.id), source_urls: [...new Set(references.map(r => r.sourceUrl))],
      ...(source === 'catalog_attribute_max' || source === 'catalog_category_max' ? { limitation: 'Maximum of an incomplete reference catalog, not a guaranteed real-world upper bound.' } : {}) };
  }
  if (manual !== undefined) return result(manual, 'user');
  // Retain the prior explicit override, but do not invent a global unknown-item ceiling.
  if (user.fallbackUnitWeightKg !== undefined) return result(user.fallbackUnitWeightKg, 'fallback_ceiling');
  const catalog = user.weightReferences ?? DEFAULT_WEIGHT_REFERENCES;
  const seen = new Set<string>();
  for (const r of catalog) {
    if (!r.id || seen.has(r.id) || !Number.isFinite(r.unitKg) || r.unitKg <= 0 || !/^https:\/\//.test(r.sourceUrl)
      || !Number.isFinite(Date.parse(r.checkedOn))) throw new Error('Weight references need unique IDs, positive unit kg and dated source URLs.');
    seen.add(r.id);
  }
  const state = item.flags.includes('assumed_empty') ? 'empty' : item.flags.includes('assumed_full') ? 'full' : 'not_applicable';
  const category = catalog.filter(r => r.label === item.label && r.state === state);
  if (!category.length) return undefined;
  const attributes = Object.entries(item.attributes);
  const known = attributes.length > 0 && attributes.every(([, value]) => value !== null);
  const matching = known ? category.filter(r => attributes.every(([key, value]) => r.attributes[key] === value)) : [];
  const candidates = matching.length ? matching : category;
  const ceiling = Math.max(...candidates.map(r => r.unitKg));
  return result(ceiling, matching.length ? 'catalog_attribute_max' : 'catalog_category_max', candidates.filter(r => r.unitKg === ceiling));
}
