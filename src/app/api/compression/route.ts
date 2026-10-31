import { estimateCompressedVolume, isCompressionRequest } from "@/lib/compression";
import { loadCompressionReferences } from "@/lib/compression-retailers";

export const runtime = "nodejs";

/** Provisional T06 interface; returns estimates without modifying inventory. */
export async function POST(request: Request) {
  let input: unknown;
  try {
    // Bound request reading even when Content-Length is absent or untrusted.
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Empty body");
    const decoder = new TextDecoder();
    let body = "";
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 4096) return Response.json({ error: "Request too large" }, { status: 413 });
        body += decoder.decode(chunk.value, { stream: true });
      }
      input = JSON.parse(body + decoder.decode());
    } finally { await reader.cancel(); reader.releaseLock(); }
  } catch {
    return Response.json({ error: "Expected a JSON compression request" }, { status: 400 });
  }
  if (!isCompressionRequest(input)) return Response.json({
    error: "Provide itemId, objectKind (puffer-jacket/pillow/sleeping-bag/blanket), fillMaterial (down/synthetic/wool/cotton), and positive finite uncompressedVolumeLiters.",
  }, { status: 400 });
  const references = await loadCompressionReferences(input.fillMaterial);
  const result = estimateCompressedVolume(input, references);
  return Response.json({ result, references }, {
    status: result.status === "estimated" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
