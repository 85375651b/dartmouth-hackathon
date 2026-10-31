import type { ItemId, SuitcaseId, CompressionReference, FillMaterial, CompressibleObjectKind } from '../types.ts';
import type { PackingInventoryItem, PackingBundle } from '../packing/bundles.ts';
import type { BaggageDetails } from '../packing/baggage-tags.ts';
import type { Analysis, Category } from '../photo-packing/types.ts';
import type { Raster } from '../photo-packing/detect.ts';
import type { ObjectImage } from '../vision/identify-objects.ts';
import type { WeightReference } from './weight-estimator.ts';
import type { LiquidBundleResult } from './liquids-adapter.ts';
import type { ContainerCapacity } from './container-capacity.ts';
import type { IdentityLedger } from './identity-ledger.ts';

/** Integration DTO only. Existing shared cm/kg/L types are not changed. */
export interface DimsIn { lengthIn: number; widthIn: number; heightIn: number }
export interface PipelineBag {
  id: SuitcaseId; kind: 'carry-on' | 'checked'; interiorIn: DimsIn;
  emptyWeightKg: number; maxWeightKg: number; capacityLiters: number;
}
export interface PipelineImage extends ObjectImage {
  /** Optional browser-decoded, orientation-corrected raster for Anna's detector. */
  raster?: Raster;
  photoId: string;
}
export interface Instance {
  id: string; item_id: ItemId; origin: 'observed' | 'count_margin';
  detection_id?: string;
  region?: { photo_id: string; analysis_width: number; analysis_height: number; polygonPx: { x: number; y: number }[] };
  dims?: { value: DimsIn; source: 'user' | 'photo_footprint_user_height' | 'margin_max_envelope' | 'placeholder' };
}
/** Append-only after the legacy count/tag/bundle boundary. No field gets renamed. */
export interface PipelineItem extends PackingInventoryItem {
  count_history: { ai_count: number; after_margin: number; final_count: number };
  instances: Instance[];
  container_capacity?: ContainerCapacity;
  classification?: { category: Category; part_class: string; source: 'label_mapping' | 'user' | 'placeholder'; compression?: { objectKind: CompressibleObjectKind; fillMaterial: FillMaterial } };
  preferences?: { carry_on: boolean; on_top: boolean; reasons: string[] };
  priority?: 'must_have' | 'nice_to_have';
  weight?: { unitKg: number; totalKg: number; source: 'user' | 'fallback_ceiling' | 'catalog_attribute_max' | 'catalog_category_max' | 'placeholder'; review_required: boolean;
    reference_ids?: string[]; source_urls?: string[]; limitation?: string };
  volume?: { uncompressedLiters: number; packedLiters: number; source: 'bounding_boxes' | 'compression'; reference_id?: string; warnings: string[] };
}
export interface ItemInput {
  baggage?: BaggageDetails;
  /** Applies to each actual unit in this homogeneous entry; overrides by instance below. */
  dimsIn?: DimsIn; heightIn?: number; unitWeightKg?: number;
  category?: Category; compression?: { objectKind: CompressibleObjectKind; fillMaterial: FillMaterial };
  priority?: 'must_have' | 'nice_to_have'; preferCarryOn?: boolean; preferOnTop?: boolean;
  valuable?: boolean; changeOfClothes?: boolean; canWear?: boolean;
  liquidShape?: 'cylinder' | 'box'; uprightOnly?: boolean; heightAxis?: 0 | 1 | 2;
}
export interface UserInputs {
  identityLedger?: IdentityLedger;
  changeOfClothesInstanceIds?: string[];
  /** Prototype default true; disable for strict missing-measurement handling. */
  usePlaceholders?: boolean;
  items?: Record<string, ItemInput>;
  instanceDimsIn?: Record<string, DimsIn>;
  /** Explicit reviewed detection -> stable instance ID association; never list-order matching. */
  matches?: Record<string, string>;
  referenceBagId?: SuitcaseId;
  /** Can supply the existing browser detector's output without decoding on the server. */
  photoAnalysis?: Analysis;
  fallbackUnitWeightKg?: number;
  weightReferences?: readonly WeightReference[];
  liquidPacking?: { slack?: number; restarts?: number; seed?: number };
  /** Output of a dimensions/capacity stage, keyed by stable source item ID. */
  containerCapacities?: Record<string, ContainerCapacity>;
  compressionReferences?: CompressionReference[];
  bundleDimsIn?: Record<string, DimsIn>;
  /** Default false: even a correct compression ratio does not establish packed shape. */
  acceptConservativeBundleEnvelope?: boolean;
}
/** Derived packing geometry; deliberately no own mass. Mass is looked up via instance IDs. */
export interface PackingUnit {
  id: string; bundle_id?: string; instance_ids: string[];
  dimsIn: DimsIn; packedVolumeLiters: number; geometry_source: 'instance' | 'user_bundle' | 'side_by_side_envelope' | 'shoe_pair_width' | 'liquid_search';
  flexible?: boolean; uprightOnly?: boolean; liquidPacking?: LiquidBundleResult;
  category: Category; allowedBagIds: SuitcaseId[];
  preferCarryOn: boolean; preferOnTop: boolean; priority: 'must_have' | 'nice_to_have';
}
export interface Assignment { unit_id: string; bag_id: SuitcaseId }
export interface LayerPlacement extends Assignment { layer: number; order: number; xIn: number; yIn: number; rotated: boolean }
export interface LayerResult { placements: LayerPlacement[]; rejected: (Assignment & { reason: string })[]; warnings: string[] }
export interface Fallback {
  unit_id: string; reason: string; must_have: boolean;
  suggestions: ('move_to_other_bag' | 'wear_on_person' | 'leave_at_home' | 'revise_bags_or_measurements')[];
  requires_user_decision: true;
}
export interface PipelineResult {
  status: 'proposal' | 'needs_input' | 'illustrative'; items: PipelineItem[]; bundles: PackingBundle[];
  identityLedger: IdentityLedger;
  units: PackingUnit[]; placements: LayerPlacement[]; fallback: Fallback[];
  issues: string[]; warnings: string[]; attempts: number; totalItemWeightKg: number | null;
  calibration?: { bag_id: SuitcaseId; analysis: Analysis };
}
