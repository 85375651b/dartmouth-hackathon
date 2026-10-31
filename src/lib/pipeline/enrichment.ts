import { detectPhoto } from '../photo-packing/detect.ts';
import { estimateCompressedVolume } from '../compression.ts';
import type { Analysis } from '../photo-packing/types.ts';
import type { DimensionsCm } from '../types.ts';
import type { DimsIn, Instance, PipelineBag, PipelineImage, PipelineItem, UserInputs } from './contracts.ts';
import { estimate_weight } from './weight-estimator.ts';
import { PLACEHOLDER_DEPTH_IN, PLACEHOLDER_DIMS_IN, PLACEHOLDER_UNIT_WEIGHT_KG } from './placeholders.ts';

export const CM_PER_IN = 2.54;
export const LITERS_PER_IN3 = 0.016387064;
export function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive and finite.`);
  return value;
}
export function validateDims(d: DimsIn): DimsIn {
  for (const v of [d.lengthIn, d.widthIn, d.heightIn]) positive(v, 'Dimension in inches');
  positive(d.lengthIn * d.widthIn * d.heightIn, 'Box volume');
  return { ...d };
}
export const toCm = (d: DimsIn): DimensionsCm => ({ lengthCm: d.lengthIn * CM_PER_IN, widthCm: d.widthIn * CM_PER_IN, heightCm: d.heightIn * CM_PER_IN });
export const liters = (d: DimsIn) => d.lengthIn * d.widthIn * d.heightIn * LITERS_PER_IN3;

export async function detectDimensions(image: PipelineImage, bags: PipelineBag[], user: UserInputs): Promise<Analysis | undefined> {
  if (user.photoAnalysis) return structuredClone(user.photoAnalysis);
  if (!image.raster) return undefined; // Missing decoder/detection is explicit, never a guessed measurement.
  const bag = bags.find(b => b.id === user.referenceBagId);
  if (!bag) throw new Error('Select referenceBagId for the single visible calibration interior.');
  const d = toCm(bag.interiorIn);
  return detectPhoto(image.raster, { lengthCm: d.lengthCm, widthCm: d.widthCm }, image.photoId);
}

export function measureInstances(item: PipelineItem, analysis: Analysis | undefined, user: UserInputs): Instance[] {
  const input = user.items?.[item.id];
  const measured = item.instances.map((instance): Instance => {
    if (instance.origin === 'count_margin') return { ...instance };
    const matches = Object.entries(user.matches ?? {}).filter(([, id]) => id === instance.id);
    if (matches.length > 1) throw new Error(`Multiple detections claim ${instance.id}.`);
    const detection = matches.length ? analysis?.items.find(d => d.id === matches[0][0]) : undefined;
    if (matches.length && !detection) throw new Error(`Unknown detection for ${instance.id}.`);
    const linked = detection && analysis ? {
      detection_id: detection.id,
      region: { photo_id: analysis.id, analysis_width: analysis.width, analysis_height: analysis.height, polygonPx: structuredClone(detection.rawOutline) },
    } : {};
    const dims = user.instanceDimsIn?.[instance.id] ?? input?.dimsIn;
    if (dims) return { ...instance, ...linked, dims: { value: validateDims(dims), source: 'user' } };
    if (detection && input?.heightIn) return { ...instance, ...linked, dims: {
      value: validateDims({ lengthIn: detection.envelope.lengthCm / CM_PER_IN, widthIn: detection.envelope.widthCm / CM_PER_IN, heightIn: input.heightIn }),
      source: 'photo_footprint_user_height',
    } };
    if (user.usePlaceholders) return { ...instance, ...linked, dims: { value: detection
      ? { lengthIn: detection.envelope.lengthCm / CM_PER_IN, widthIn: detection.envelope.widthCm / CM_PER_IN, heightIn: PLACEHOLDER_DEPTH_IN }
      : { ...PLACEHOLDER_DIMS_IN, heightIn: input?.heightIn ?? PLACEHOLDER_DEPTH_IN }, source: 'placeholder' } };
    return { ...instance, ...linked };
  });
  const actual = measured.filter(i => i.origin === 'observed');
  if (actual.length && actual.every(i => i.dims)) {
    const largest: DimsIn = {
      lengthIn: Math.max(...actual.map(i => i.dims!.value.lengthIn)),
      widthIn: Math.max(...actual.map(i => i.dims!.value.widthIn)),
      heightIn: Math.max(...actual.map(i => i.dims!.value.heightIn)),
    };
    return measured.map(i => i.origin === 'count_margin' ? { ...i, dims: { value: largest, source: 'margin_max_envelope' } } : i);
  }
  return measured;
}

export function classifyItem(item: PipelineItem, user: UserInputs): PipelineItem['classification'] {
  const input = user.items?.[item.id];
  const type = 'type' in item.attributes ? item.attributes.type : undefined;
  const puffer = ['jacket', 'coat'].includes(item.label) && (type === 'down_puffer' || type === 'synthetic_puffer');
  const category = input?.category ?? (puffer || /^(pillow|blanket|sleeping bag)$/.test(item.label) ? 3
    : /^(shirt|pants|socks|towel|bag|pouch|backpack|tote|duffel)$/.test(item.label) ? 2
    : /^(shoes|book|notebook|laptop|power bank|mug|cup|water bottle|flask)$/.test(item.label) || item.flags.includes('assumed_full') ? 1 : undefined);
  if (!category) return user.usePlaceholders ? { category: 1, part_class: 'rigid', source: 'placeholder' } : undefined;
  const compression = input?.compression ?? (puffer ? { objectKind: 'puffer-jacket' as const, fillMaterial: type === 'down_puffer' ? 'down' as const : 'synthetic' as const } : undefined);
  return { category, part_class: category === 1 ? 'rigid' : category === 2 ? 'semi_rigid_foldable' : 'puffy_compressible', source: input?.category ? 'user' : 'label_mapping', ...(compression ? { compression } : {}) };
}

export function preferItem(item: PipelineItem, user: UserInputs): NonNullable<PipelineItem['preferences']> {
  const input = user.items?.[item.id];
  const reasons: string[] = [];
  // Proposed explicit shortlist, not a legal rule or a random outfit selector.
  if (/^(medication|medicine|prescription medication|passport|documents|travel documents|wallet|jewelry|laptop|camera)$/.test(item.label)) reasons.push('essential_label');
  if (input?.valuable) reasons.push('user_valuable');
  if (input?.changeOfClothes) reasons.push('user_change_of_clothes');
  return { carry_on: input?.preferCarryOn ?? reasons.length > 0, on_top: input?.preferOnTop ?? reasons.length > 0, reasons };
}

/** Public compatibility entrypoint; estimate_weight uses dated reference maxima. */
export function estimateWeight(item: PipelineItem, user: UserInputs): PipelineItem['weight'] {
  return estimate_weight(item, user) ?? (user.usePlaceholders ? { unitKg: PLACEHOLDER_UNIT_WEIGHT_KG,
    totalKg: PLACEHOLDER_UNIT_WEIGHT_KG * item.count, source: 'placeholder', review_required: true } : undefined);
}

export function estimateVolume(item: PipelineItem, user: UserInputs): PipelineItem['volume'] {
  if (!item.instances.every(i => i.dims)) return undefined;
  const uncompressedLiters = item.instances.reduce((sum, i) => sum + liters(i.dims!.value), 0);
  const spec = item.classification?.compression;
  if (!spec) return { uncompressedLiters, packedLiters: uncompressedLiters, source: 'bounding_boxes', warnings: [] };
  const result = estimateCompressedVolume({ itemId: item.id, ...spec, uncompressedVolumeLiters: uncompressedLiters }, user.compressionReferences ?? []);
  if (result.status === 'unavailable') return { uncompressedLiters, packedLiters: uncompressedLiters, source: 'bounding_boxes', warnings: [`Compression unavailable; retain uncompressed envelope: ${result.reason}`] };
  return { uncompressedLiters, packedLiters: result.compressedVolumeLiters, source: 'compression', reference_id: result.referenceId, warnings: result.warnings };
}
