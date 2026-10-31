import type { CompressionReference, CompressionRequest, CompressionResult } from "./types.ts";

export function isCompressionRequest(value: unknown): value is CompressionRequest {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return typeof input.itemId === "string" && /^item-.+/.test(input.itemId)
    && ["puffer-jacket", "pillow", "sleeping-bag", "blanket"].includes(input.objectKind as string)
    && ["down", "synthetic", "wool", "cotton"].includes(input.fillMaterial as string)
    && typeof input.uncompressedVolumeLiters === "number"
    && Number.isFinite(input.uncompressedVolumeLiters)
    && input.uncompressedVolumeLiters > 0;
}

export function isUsableReference(reference: CompressionReference): boolean {
  return Number.isFinite(reference.baselineVolumeLiters)
    && Number.isFinite(reference.compressedVolumeLiters)
    && reference.baselineVolumeLiters > 0
    && reference.compressedVolumeLiters > 0
    && reference.compressedVolumeLiters <= reference.baselineVolumeLiters
    && ["uncompressed", "stuff-sack-proxy"].includes(reference.baselineKind)
    && Number.isFinite(Date.parse(reference.retrievedAt))
    && reference.sourceUrl.startsWith("https://")
    && reference.id.startsWith("compression-")
    && reference.listingName.trim().length > 0 && reference.variant.trim().length > 0;
}

/** Pure T06 building block: no fetching, state mutation, or rounding. */
export function estimateCompressedVolume(
  input: CompressionRequest,
  references: readonly CompressionReference[],
): CompressionResult {
  if (!isCompressionRequest(input)) throw new TypeError("Invalid compression request");
  const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const needsBedding = input.objectKind === "blanket"
    || input.fillMaterial === "wool" || input.fillMaterial === "cotton";
  const candidates = references.filter((reference) =>
    reference.fillMaterial === input.fillMaterial && isUsableReference(reference)
    && (!needsBedding || (
      (reference.productKind === "pillow" || reference.productKind === "mattress")
      && reference.baselineKind === "uncompressed"
      && Boolean(reference.measurementEvidence?.material.trim())
      && Boolean(reference.measurementEvidence?.baseline.trim())
      && Boolean(reference.measurementEvidence?.compressed.trim())
      && (!(input.fillMaterial === "wool" || input.fillMaterial === "cotton")
        || new RegExp(`^(?:Filling|Fill):\\s*100%\\s*(?:pure\\s+)?${input.fillMaterial}\\.?$`, "i")
          .test(reference.measurementEvidence?.material.trim() ?? ""))
    )));
  // Prefer genuinely uncompressed measurements; otherwise use an explicit proxy.
  // Closest baseline size is a tie-break heuristic, not a material property.
  candidates.sort((a, b) =>
    Number(a.baselineKind === "stuff-sack-proxy") - Number(b.baselineKind === "stuff-sack-proxy")
    || Math.abs(a.baselineVolumeLiters - input.uncompressedVolumeLiters)
       - Math.abs(b.baselineVolumeLiters - input.uncompressedVolumeLiters)
    || compareId(a.id, b.id));
  const reference = candidates[0];
  if (!reference) return {
    status: "unavailable", itemId: input.itemId,
    reason: needsBedding
      ? `No eligible ${input.fillMaterial} pillow or mattress reference with both expanded and compressed object volumes. Missing thickness, ambiguous packed geometry, shipping boxes, and cover-only material matches cannot establish a ratio.`
      : `No valid sleeping-bag reference for ${input.fillMaterial} fill.`,
  };
  const ratio = reference.compressedVolumeLiters / reference.baselineVolumeLiters;
  const compressedVolumeLiters = ratio * input.uncompressedVolumeLiters;
  if (!(ratio > 0) || !(compressedVolumeLiters > 0)) return {
    status: "unavailable", itemId: input.itemId, reason: "Volumes are outside numerical range.",
  };
  const warnings = [
    needsBedding
      ? "Material-matched bedding estimate; compression pressure, construction and fill quality may differ. Fit is not guaranteed."
      : "Material-matched sleeping-bag estimate; compression pressure, construction and fill quality may differ. Fit is not guaranteed.",
  ];
  if (reference.baselineKind === "stuff-sack-proxy") warnings.push(
    "Reference baseline is a mildly compressed stuff-sack volume, not true lofted volume. Applying its ratio to lofted volume is an unvalidated proxy.",
  );
  if (needsBedding) warnings.push(
    "Transferring a pillow or mattress ratio to a blanket or other textile has not been calibrated. Factory vacuum compression may not be achievable while packing luggage.",
  );
  else if (input.objectKind !== "sleeping-bag") warnings.push(
    "Transferring a sleeping-bag ratio to a jacket or pillow has not been calibrated against measurements.",
  );
  return { status: "estimated", itemId: input.itemId, referenceId: reference.id,
    ratio, compressedVolumeLiters, warnings };
}
