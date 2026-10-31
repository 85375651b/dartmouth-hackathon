/** Server-only network adapter. Import from route handlers or Node scripts. */
import { isUsableReference } from "./compression.ts";
import { parseBeddingPage } from "./compression-bedding.ts";
import type { CompressionReference, FillMaterial } from "./types.ts";

// Fixed product pages: caller input never becomes a fetch URL. No redirect following.
const SOURCES = {
  down: {
    url: "https://www.adventurebase.com.au/sea-to-summit-trek-down-sleeping-bag",
    name: "Sea to Summit Trek Down Sleeping Bag",
  },
  synthetic: {
    url: "https://kodiakoutfitters.com/products/alps-mountaineering-gemini-0-double-sleeping-bag",
    name: "ALPS Mountaineering Gemini 0 Double Sleeping Bag",
  },
  cotton: {
    url: "https://redcamp.com/products/small-camping-pillows-for-sleeping",
    name: "REDCAMP Small Camping Pillows for Sleeping",
  },
  wool: {
    url: "https://www.gz-bag.de/products/kissen-sleepwool-travel-pillow",
    name: "Grüezi Bag SleepWool Travel Pillow",
  },
} as const;
const MAX_BYTES = 4 * 1024 * 1024;
const TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 30_000;

function textOnly(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

/** Site-specific extraction; do not guess volumes from sleeping-person dimensions. */
export function parseRetailerPage(
  material: FillMaterial, html: string, retrievedAt: string,
): CompressionReference[] {
  const source = SOURCES[material];
  if (!source) return [];
  if (material === "wool" || material === "cotton") {
    return parseBeddingPage(material, html, retrievedAt, source);
  }
  const base = { sourceUrl: source.url, listingName: source.name, fillMaterial: material,
    retrievedAt, baselineKind: "stuff-sack-proxy" as const };
  const references: CompressionReference[] = [];
  if (material === "down") {
    const text = textOnly(html);
    // Read fill evidence from the product specs, never polyester shell or recommendations.
    if (!/Fill:\s*80\/20 Duck Down\b/i.test(text)) return [];
    const section = html.match(/<h5[^>]*>\s*COMPRESSION SACK VOLUME\/ASTM F1853-11 COMPRESSED VOLUME\s*<\/h5>([\s\S]*?)(?:<\/section>|<h[1-6]\b)/i)?.[1];
    if (!section) return [];
    const rows = textOnly(section).matchAll(/(-\d+C\|\d+F)\s+(R|L):\s*(\d+(?:\.\d+)?)L\s*\/\s*(\d+(?:\.\d+)?)L\b/g);
    for (const row of rows) references.push({ ...base,
      id: `compression-trek-${row[1].replace(/[^a-z0-9]/gi, "-")}-${row[2]}`,
      variant: `${row[1]} ${row[2]}`,
      baselineVolumeLiters: Number(row[3]), compressedVolumeLiters: Number(row[4]),
    });
  } else {
    // Isolate a specification table containing all three fields, excluding JSON/reviews.
    for (const match of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
      const cells = new Map<string, string>();
      for (const row of match[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const pair = [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)];
        if (pair.length === 2) cells.set(textOnly(pair[0][1]), textOnly(pair[1][1]));
      }
      if (cells.get("Insulation Type") !== "Synthetic") continue;
      const baseline = cells.get("Stuff Sack Volume")?.match(/^(\d+(?:\.\d+)?) liters$/);
      const compressed = cells.get("Compressed Volume")?.match(/^(\d+(?:\.\d+)?) liters$/);
      if (!baseline || !compressed) continue;
      references.push({ ...base, id: "compression-gemini-0-double", variant: "Double",
        baselineVolumeLiters: Number(baseline[1]), compressedVolumeLiters: Number(compressed[1]) });
      break;
    }
  }
  // Ambiguous duplicate variants are not usable evidence.
  return references.filter((reference) => isUsableReference(reference)
    && references.filter((other) => other.id === reference.id).length === 1);
}

async function readLimited(response: Response): Promise<string> {
  if (!response.body) throw new Error("Empty response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let html = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("Retailer page exceeds size limit");
      html += decoder.decode(value, { stream: true });
    }
    return html + decoder.decode();
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

/** Fresh successful references only; failures briefly cached, stale values never reused. */
export function createRetailerLoader(fetchPage: typeof fetch = fetch) {
  const cache = new Map<FillMaterial, { expires: number; references: CompressionReference[] }>();
  const pending = new Map<FillMaterial, Promise<CompressionReference[]>>();
  return async function load(material: FillMaterial): Promise<CompressionReference[]> {
    if (!Object.hasOwn(SOURCES, material)) return [];
    const hit = cache.get(material);
    if (hit && hit.expires > Date.now()) return structuredClone(hit.references);
    let task = pending.get(material);
    if (!task) {
      task = (async () => {
        let references: CompressionReference[] = [];
        try {
          const response = await fetchPage(SOURCES[material].url, {
            redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000),
            headers: { Accept: "text/html", "User-Agent": "PackWise/0.1 (textile-volume-research)" },
          });
          if (!response.ok || response.redirected
            || !response.headers.get("content-type")?.includes("text/html")) {
            await response.body?.cancel();
            throw new Error("Retailer unavailable");
          }
          const html = await readLimited(response);
          references = parseRetailerPage(material, html, new Date().toISOString());
        } catch {
          // Blocked pages, changed specs, timeouts and network errors all mean unknown.
        }
        cache.set(material, { expires: Date.now() + (references.length ? TTL_MS : FAILURE_TTL_MS), references });
        return references;
      })();
      pending.set(material, task);
    }
    try { return structuredClone(await task); }
    finally { pending.delete(material); }
  };
}

export const loadCompressionReferences = createRetailerLoader();
