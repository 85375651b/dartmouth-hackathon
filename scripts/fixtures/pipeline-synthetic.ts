import { packingItemId } from '../../src/lib/packing/bundles.ts';
import { createPipeline } from '../../src/lib/pipeline/run-pipeline.ts';
import type { PipelineBag, PipelineImage, UserInputs } from '../../src/lib/pipeline/contracts.ts';

/** Entirely synthetic: no real photo recognition, retailer evidence, or weights. */
export const rawObjects = [
  { label: 'suitcase', count: 1, attributes: {}, flags: [] },
  { label: 'shirt', count: 7, attributes: {}, flags: [] },
  { label: 'shoes', count: 3, attributes: { type: 'sneakers_running' }, flags: [] },
  { label: 'shampoo', count: 1, attributes: {}, flags: [] },
  { label: 'lotion', count: 1, attributes: {}, flags: [] },
  { label: 'power bank', count: 1, attributes: {}, flags: [] },
  { label: 'jacket', count: 1, attributes: { type: 'down_puffer' }, flags: [] },
  { label: 'surfboard', count: 1, attributes: {}, flags: [] },
] as const;
export const idFor = (label: string) => packingItemId(rawObjects.find(o => o.label === label)!);

export function syntheticInputs(): { image: PipelineImage; bags: PipelineBag[]; user: UserInputs } {
  const width = 800, height = 600, data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([245, 245, 245, 255], i);
  function rect(x0: number, y0: number, w: number, h: number, color: number[]) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) data.set([...color, 255], (y * width + x) * 4);
  }
  rect(30, 80, 300, 180, [30, 30, 35]); rect(50, 100, 260, 140, [155, 155, 160]);
  const matches: Record<string, string> = {};
  let index = 0;
  for (const object of rawObjects.slice(1)) for (let unit = 1; unit <= object.count; unit++) {
    rect(380 + index % 3 * 100, 50 + Math.floor(index / 3) * 100, 45, 40, [35, 70, 170]);
    matches[`synthetic-photo-object-${index + 1}`] = `${packingItemId(object)}:instance:${unit}`; index++;
  }
  return {
    image: { photoId: 'synthetic-photo', bytes: new Uint8Array([1]), mimeType: 'image/png', raster: { width, height, data } },
    bags: [
      { id: 'case-cabin', kind: 'carry-on', interiorIn: { lengthIn: 26, widthIn: 14, heightIn: 10 }, emptyWeightKg: 2, maxWeightKg: 10, capacityLiters: 50 },
      { id: 'case-checked', kind: 'checked', interiorIn: { lengthIn: 30, widthIn: 20, heightIn: 15 }, emptyWeightKg: 4, maxWeightKg: 23, capacityLiters: 100 },
    ],
    user: { usePlaceholders: false, referenceBagId: 'case-cabin', matches, acceptConservativeBundleEnvelope: true,
      items: {
        [idFor('shirt')]: { heightIn: 1, unitWeightKg: .2, priority: 'nice_to_have', canWear: true },
        [idFor('shoes')]: { heightIn: 3, unitWeightKg: .4 },
        [idFor('shampoo')]: { heightIn: 2, unitWeightKg: .08, baggage: { containerCapacityLiters: .05 } },
        [idFor('lotion')]: { heightIn: 2, unitWeightKg: .3, baggage: { containerCapacityLiters: .25 } },
        [idFor('power bank')]: { heightIn: .5, unitWeightKg: .25 },
        [idFor('jacket')]: { heightIn: 4, unitWeightKg: .6, canWear: true },
        [idFor('surfboard')]: { dimsIn: { lengthIn: 100, widthIn: 25, heightIn: 4 }, unitWeightKg: 5, category: 1, priority: 'nice_to_have' },
      },
      compressionReferences: [{ id: 'compression-synthetic-down', listingName: 'SYNTHETIC TEST ONLY', variant: 'fixture', sourceUrl: 'https://example.invalid/synthetic',
        retrievedAt: '2026-10-31T00:00:00Z', fillMaterial: 'down', baselineKind: 'uncompressed', baselineVolumeLiters: 10, compressedVolumeLiters: 5 }],
    },
  };
}
export const syntheticPipeline = createPipeline({ identify: async () => structuredClone(rawObjects) });

export async function runSynthetic() {
  const { image, bags, user } = syntheticInputs();
  return syntheticPipeline(image, bags, user);
}
