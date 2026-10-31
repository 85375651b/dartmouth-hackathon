import type { CompressionReference, FillMaterial } from "./types.ts";
import { isUsableReference } from "./compression.ts";

function plain(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&quot;/gi, '"').replace(/&times;/gi, "×")
    .replace(/\s+/g, " ").trim();
}

/** Only fully specified object volumes; boxes and two-dimensional sizes are rejected. */
export function beddingVolumeLiters(measurement: string): number | null {
  const value = plain(measurement);
  const direct = value.match(/^(\d+(?:\.\d+)?)\s*(?:L|liters?|litres?)$/i);
  if (direct) return positive(Number(direct[1]));
  const box = value.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(cm|inches|in)$/i);
  if (box) {
    const scale = box[4].toLowerCase() === "cm" ? 1 : 2.54;
    return positive(Number(box[1]) * Number(box[2]) * Number(box[3]) * scale ** 3 / 1000);
  }
  // Diameter must be explicit; "11 x 6 inches" does not establish a cylinder.
  const cylinder = value.match(/^(?:Ø|diameter)\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(cm|inches|in)$/i);
  if (cylinder) {
    const scale = cylinder[3].toLowerCase() === "cm" ? 1 : 2.54;
    return positive(Math.PI * (Number(cylinder[1]) * scale / 2) ** 2 * Number(cylinder[2]) * scale / 1000);
  }
  return null;
}

function positive(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Generic, strict spec reader also usable by future mattress adapters. */
export function beddingReferenceFromSpecs(spec: {
  id: CompressionReference["id"];
  listingName: string;
  variant: string;
  sourceUrl: string;
  retrievedAt: string;
  productKind: "pillow" | "mattress";
  material: "wool" | "cotton";
  materialEvidence: string;
  expanded: string;
  compressed: string;
}): CompressionReference | null {
  // Match the filling, never a cover, blend, PP cotton, or wool/foam hybrid.
  const material = plain(spec.materialEvidence);
  const explicit = new RegExp(`^(?:Filling|Fill):\\s*100%\\s*(?:pure\\s+)?${spec.material}\\.?$`, "i");
  if (!explicit.test(material)) return null;
  const baselineVolumeLiters = beddingVolumeLiters(spec.expanded);
  const compressedVolumeLiters = beddingVolumeLiters(spec.compressed);
  if (baselineVolumeLiters === null || compressedVolumeLiters === null) return null;
  const reference: CompressionReference = {
    id: spec.id, listingName: spec.listingName, variant: spec.variant,
    sourceUrl: spec.sourceUrl, retrievedAt: spec.retrievedAt,
    fillMaterial: spec.material, productKind: spec.productKind, baselineKind: "uncompressed",
    baselineVolumeLiters, compressedVolumeLiters,
    measurementEvidence: { material: spec.materialEvidence, baseline: spec.expanded, compressed: spec.compressed },
  };
  return isUsableReference(reference) ? reference : null;
}

/** Read one product's structured description, never recommendations, covers or reviews.
 * Current source pages lack complete measurements and correctly produce no references.
 * Explicitly labeled specs are accepted only if the retailer later supplies them.
 */
export function parseBeddingPage(
  material: FillMaterial, html: string, retrievedAt: string,
  source: { url: string; name: string },
): CompressionReference[] {
  if (material !== "wool" && material !== "cotton") return [];
  const products: Record<string, unknown>[] = [];
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node["@type"] === "Product") products.push(node);
    if (Array.isArray(node["@graph"])) node["@graph"].forEach(collect);
  };
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(script[1])) continue;
    try { collect(JSON.parse(script[2])); } catch { /* Invalid structured data is unknown. */ }
  }
  const expectedName = material === "cotton" ? /^Small Camping Pillows for Sleeping$/i : /^SleepWool (?:Travel Pillow|Reisekissen)$/i;
  const matched = products.filter((product) => typeof product.name === "string" && expectedName.test(product.name));
  if (matched.length !== 1 || typeof matched[0].description !== "string") return [];
  // Read separate labeled fields in one description: never combine variants or pages.
  const description = matched[0].description.replace(/<\/(?:p|li|div)>|<br\s*\/?>/gi, ";");
  const fields = description.split(/[;\n]/).map(plain).filter(Boolean);
  const single = (pattern: RegExp): string | undefined => {
    const found = fields.filter((field) => pattern.test(field));
    return found.length === 1 ? found[0] : undefined;
  };
  const fill = single(/^(?:Filling|Fill):/i);
  const expanded = single(/^Expanded (?:volume|dimensions):/i)?.replace(/^[^:]+:\s*/, "");
  const compressed = single(/^Compressed (?:volume|dimensions):/i)?.replace(/^[^:]+:\s*/, "");
  if (!fill || !expanded || !compressed) return [];
  const reference = beddingReferenceFromSpecs({
    id: `compression-${material}-pillow`, listingName: source.name, variant: "Single pillow",
    sourceUrl: source.url, retrievedAt, productKind: "pillow", material,
    materialEvidence: fill, expanded, compressed,
  });
  return reference ? [reference] : [];
}
