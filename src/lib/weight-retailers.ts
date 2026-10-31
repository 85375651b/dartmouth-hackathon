/** Server-only network adapter for live item weights. Import from route handlers or Node scripts. */
import type { WeightReference } from "./pipeline/weight-estimator.ts";

/**
 * Fixed product sources: caller input never becomes a fetch URL. No redirect following.
 * Each source maps one product to the recognizer labels it stands in for.
 * - `shopify`: the store's public product JSON; the weight is the merchant's listed
 *   shipping weight per size (`grams`), which may include packaging. Largest size wins.
 * - `spec-page`: an HTML spec sheet with "Weight: …" lines. Heaviest listed value wins.
 * `perUnit` divides the listed weight, e.g. a pair of shoes into one shoe, because the
 * recognizer counts shoes individually.
 */
export const WEIGHT_SOURCES = [
  { id: "live-weight-macbook-air", kind: "spec-page", url: "https://support.apple.com/en-au/122209",
    labels: ["laptop"], attributes: { type: "ultrabook_thin_light" }, perUnit: 1 },
  { id: "live-weight-macbook-pro", kind: "spec-page", url: "https://support.apple.com/en-ie/121554",
    labels: ["laptop"], attributes: { type: "gaming_or_workstation" }, perUnit: 1 },
  { id: "live-weight-anker-a1695", kind: "spec-page", url: "https://www.anker.com/products/a1695-anker-power-bank-25000mah-165w",
    labels: ["power bank"], attributes: {}, perUnit: 1 },
  { id: "live-weight-wp-crew-tee", kind: "shopify", url: "https://woolandprince.com/products/signature-crew-neck-tee-oatmeal-heather",
    labels: ["shirt", "t-shirt"], attributes: {}, perUnit: 1 },
  { id: "live-weight-wp-long-sleeve-tee", kind: "shopify", url: "https://woolandprince.com/products/signature-long-sleeve-tee-hunter-green",
    labels: ["shirt"], attributes: {}, perUnit: 1 },
  { id: "live-weight-wp-chino", kind: "shopify", url: "https://woolandprince.com/products/stretch-tech-chino-pant-black",
    labels: ["pants", "trousers"], attributes: {}, perUnit: 1 },
  { id: "live-weight-wp-sweater", kind: "shopify", url: "https://woolandprince.com/products/crew-neck-sweater-2026-navy",
    labels: ["sweater"], attributes: {}, perUnit: 1 },
  { id: "live-weight-or-townsend-down", kind: "shopify", url: "https://outdoorresearch.com/products/mens-townsend-down-jacket-322802",
    labels: ["jacket"], attributes: { type: "down_puffer" }, perUnit: 1 },
  { id: "live-weight-allbirds-canvas-runner", kind: "shopify", url: "https://allbirds.com/products/mens-canvas-runner-nz",
    labels: ["shoes"], attributes: { type: "sneakers_running" }, perUnit: 2 },
] as const;

export type WeightSource = (typeof WEIGHT_SOURCES)[number];

const MAX_BYTES = 4 * 1024 * 1024;
const TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 30_000;
/** Anything outside this range is treated as a parsing error, not a weight. */
const MIN_KG = 0.01;
const MAX_KG = 10;
const KG_PER = { kg: 1, g: 0.001, grams: 0.001, oz: 0.028349523125, ounces: 0.028349523125, lb: 0.45359237, lbs: 0.45359237, pounds: 0.45359237 } as const;

function textOnly(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&shy;/gi, "")
    .replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function plausible(kg: number): number | null {
  return Number.isFinite(kg) && kg >= MIN_KG && kg <= MAX_KG ? kg : null;
}

/** Heaviest variant from a Shopify `/products/<handle>.json` body, in kg; zero-gram variants are ignored. */
export function parseShopifyWeightKg(json: unknown): number | null {
  const variants = (json as { product?: { variants?: unknown } } | null)?.product?.variants;
  if (!Array.isArray(variants)) return null;
  const grams = variants.map((v) => (v as { grams?: unknown }).grams)
    .filter((g): g is number => typeof g === "number" && Number.isFinite(g) && g > 0);
  return grams.length ? plausible(Math.max(...grams) / 1000) : null;
}

/** Heaviest "Weight: <n> <unit>" (or "Weight (variant): …") on a spec page, in kg. */
export function parseSpecPageWeightKg(html: string): number | null {
  const weights = [...textOnly(html).matchAll(/\bWeight\b(?:\s*\([^)]{1,40}\))?\s*:?\s*(\d+(?:\.\d+)?)\s*(kg|grams|g|ounces|oz|pounds|lbs|lb)\b/gi)]
    .map((m) => Number(m[1]) * KG_PER[m[2].toLowerCase() as keyof typeof KG_PER]);
  return weights.length ? plausible(Math.max(...weights)) : null;
}

/** One WeightReference per label the source stands in for. */
export function toWeightReferences(source: WeightSource, listedKg: number, checkedOn: string): WeightReference[] {
  return source.labels.map((label) => ({
    id: source.labels.length > 1 ? `${source.id}-${label.replace(/\s+/g, "-")}` : source.id,
    label, attributes: { ...source.attributes }, unitKg: listedKg / source.perUnit,
    state: "not_applicable", sourceUrl: source.url, checkedOn,
  }));
}

async function readLimited(response: Response): Promise<string> {
  if (!response.body) throw new Error("Empty response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("Retailer page exceeds size limit");
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export interface LiveWeightResult {
  references: WeightReference[];
  /** Source IDs that were blocked, timed out, changed layout or gave an implausible value. */
  unavailable: string[];
}

/** Fresh successful values only; failures briefly cached, stale values never reused. */
export function createWeightLoader(fetchPage: typeof fetch = fetch) {
  const cache = new Map<string, { expires: number; references: WeightReference[] }>();
  const pending = new Map<string, Promise<WeightReference[]>>();

  async function loadSource(source: WeightSource): Promise<WeightReference[]> {
    const hit = cache.get(source.id);
    if (hit && hit.expires > Date.now()) return hit.references;
    let task = pending.get(source.id);
    if (!task) {
      task = (async () => {
        let references: WeightReference[] = [];
        try {
          const json = source.kind === "shopify";
          const response = await fetchPage(json ? `${source.url}.json` : source.url, {
            redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000),
            headers: { Accept: json ? "application/json" : "text/html", "User-Agent": "PackWise/0.1 (item-weight-research)" },
          });
          if (!response.ok || response.redirected
            || !response.headers.get("content-type")?.includes(json ? "application/json" : "text/html")) {
            await response.body?.cancel();
            throw new Error("Retailer unavailable");
          }
          const body = await readLimited(response);
          const kg = json ? parseShopifyWeightKg(JSON.parse(body)) : parseSpecPageWeightKg(body);
          if (kg !== null) references = toWeightReferences(source, kg, new Date().toISOString());
        } catch {
          // Blocked pages, changed specs, timeouts and network errors all mean unknown.
        }
        cache.set(source.id, { expires: Date.now() + (references.length ? TTL_MS : FAILURE_TTL_MS), references });
        return references;
      })();
      pending.set(source.id, task);
    }
    try { return await task; }
    finally { pending.delete(source.id); }
  }

  return async function load(): Promise<LiveWeightResult> {
    const results = await Promise.all(WEIGHT_SOURCES.map(loadSource));
    return {
      references: structuredClone(results.flat()),
      unavailable: WEIGHT_SOURCES.filter((_, i) => results[i].length === 0).map((s) => s.id),
    };
  };
}

export const loadLiveWeightReferences = createWeightLoader();
