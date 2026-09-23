/**
 * Turns a recipe's snapshot into what the source said (a StoredExtraction):
 * pages first; price images only if the pages give no prices, or if the recipe
 * knows they are the price table.
 *
 * Every read is cached by a hash of the content itself (state/reads.json), so the
 * same page text or the same image is never paid for twice, whatever its URL. The
 * key includes the extraction's version: changing a prompt or schema reads again.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { IMAGE_EXTRACTION_VERSION, PAGE_EXTRACTION_VERSION, normalizeExtraction } from "./extraction.ts";
import type { Reader } from "./firecrawl.ts";
import type { Http } from "./http.ts";
import { imageFormat } from "./pdf.ts";
import type { StoredExtraction } from "./reconcile.ts";
import type { Snapshot } from "./recipes/types.ts";

export const READS_PATH = "state/reads.json";
/** Cached reads nobody used for this long are dropped. */
const CACHE_DAYS = 180;
/** OCR at most this many images per race; recipes list the likeliest first. */
const MAX_IMAGES = 4;

export const ReadCacheSchema = z.record(
  z.string(),
  z.object({ kind: z.enum(["page", "image"]), json: z.record(z.string(), z.unknown()), usedAt: z.iso.datetime() }),
);
export type ReadCache = z.infer<typeof ReadCacheSchema>;

export const parseReadCache = (text: string | null): ReadCache => (text ? ReadCacheSchema.parse(JSON.parse(text)) : {});

export function pruneReadCache(cache: ReadCache, now: Date): ReadCache {
  const cutoff = new Date(now.getTime() - CACHE_DAYS * 86_400_000).toISOString();
  return Object.fromEntries(Object.entries(cache).filter(([, v]) => v.usedAt >= cutoff));
}

export type ReadOutcome =
  | { ok: true; extraction: StoredExtraction; paidReads: number; cachedReads: number; notes: string[] }
  | { ok: false; reason: string; capped?: boolean };

export async function readSnapshot(snap: Snapshot, reader: Reader, http: Http, cache: ReadCache, now: Date): Promise<ReadOutcome> {
  let paidReads = 0;
  let cachedReads = 0;
  const notes: string[] = [];
  const usedAt = now.toISOString();

  const cached = async (key: string, kind: "page" | "image", read: () => ReturnType<Reader["readHtml"]>) => {
    const hit = cache[key];
    if (hit) {
      hit.usedAt = usedAt;
      cachedReads++;
      return { ok: true as const, json: hit.json };
    }
    const result = await read();
    if (result.ok) {
      cache[key] = { kind, json: result.json, usedAt };
      paidReads++;
    }
    return result;
  };

  const pages: { url: string; json: Record<string, unknown> }[] = [];
  for (const page of snap.pages) {
    const result = await cached(`page:${PAGE_EXTRACTION_VERSION}:${hash(page.html)}`, "page", () => reader.readHtml(page.html, slugOf(page.url)));
    if (!result.ok) {
      const reason = page.url === snap.url ? result.error : `${page.url}: ${result.error}`;
      return { ok: false, reason, capped: "capped" in result ? result.capped : undefined };
    }
    pages.push({ url: page.url, json: result.json });
  }

  const extraction: StoredExtraction = {
    ...(snap.facts && { facts: snap.facts }),
    pages,
    links: snap.links,
    ...(snap.hints?.series && { series: snap.hints.series }),
    ...(snap.hints?.organizer && { organizer: snap.hints.organizer }),
  };

  const soFar = normalizeExtraction(extraction);
  const isEvent = soFar.ok || !/not a sports event/.test(soFar.reason);
  const needImages = isEvent && (snap.priceImagesCertain || !soFar.ok || soFar.facts.prices.length === 0);
  if (needImages && snap.priceImages.length > 0) {
    const images: { url: string; json: Record<string, unknown> }[] = [];
    for (const url of snap.priceImages.slice(0, MAX_IMAGES)) {
      let bytes: Uint8Array;
      try {
        bytes = (await http.bytes(url)).bytes;
      } catch (err) {
        notes.push(`image ${url}: ${(err as Error).message}`);
        continue;
      }
      if (!imageFormat(bytes)) {
        notes.push(`image ${url}: not PNG or JPEG, skipped`);
        continue;
      }
      const result = await cached(`image:${IMAGE_EXTRACTION_VERSION}:${hash(bytes)}`, "image", () => reader.readImage(bytes, slugOf(url)));
      if (!result.ok) {
        // Out of credits halfway: better no update than a race without its prices.
        if ("capped" in result && result.capped) return { ok: false, reason: result.error, capped: true };
        notes.push(`image ${url}: ${result.error}`);
        continue;
      }
      images.push({ url, json: result.json });
    }
    if (images.length > 0) extraction.images = images;
  }
  return { ok: true, extraction, paidReads, cachedReads, notes };
}

/** What a snapshot's reading would be based on: same content, same fingerprint. */
export function snapshotFingerprint(snap: Snapshot): string {
  return hash(JSON.stringify({ pages: snap.pages.map((p) => p.html), images: snap.priceImages, facts: snap.facts ?? null })).slice(0, 32);
}

function hash(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function slugOf(url: string): string {
  return (new URL(url).pathname.split("/").filter(Boolean).pop() ?? "page").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 60) || "page";
}
