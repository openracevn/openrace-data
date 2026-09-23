/**
 * The paid reader: Firecrawl Parse (POST /v2/parse) on content we fetched ourselves.
 *
 * - A page: the relevant HTML uploaded as a .html file, with the JSON format.
 * - A price image: wrapped in a one-page PDF, OCR'd (parsers: pdf, mode ocr), with the JSON format.
 *
 * Both cost about 5 credits (1 per page + 4 for JSON; verified 2026-09-24). Uploading
 * our own HTML instead of having Firecrawl fetch the URL means it reads exactly the
 * part we fingerprinted, and client-side pages can't come back empty.
 * Requests are spaced to stay under the Free plan's 10/min; 429 and 5xx are retried.
 */
import { IMAGE_EXTRACTION, PAGE_EXTRACTION, type Extraction } from "./extraction.ts";
import { imageToPdf } from "./pdf.ts";

const API = "https://api.firecrawl.dev/v2/parse";
/** What one read costs, to stop before the cap rather than after it. */
export const CREDITS_PER_READ = 5;

export type ReadResult =
  | { ok: true; json: Record<string, unknown>; credits: number }
  | { ok: false; error: string; credits: number; capped?: boolean };

/** Reads content into extraction JSON. Firecrawl in scheduled runs; see design-v2.md for the agent path. */
export interface Reader {
  readHtml(html: string, name: string): Promise<ReadResult>;
  readImage(bytes: Uint8Array, name: string): Promise<ReadResult>;
  /** Credits spent by this reader so far. */
  readonly credits: number;
}

export class FirecrawlReader implements Reader {
  credits = 0;
  private lastRequestAt = 0;

  /** `budget`: credits this reader may still spend (the run's cap and the month's). */
  constructor(
    private readonly apiKey: string,
    private budget: number,
    private readonly minIntervalMs = 6_500,
  ) {}

  readHtml(html: string, name: string): Promise<ReadResult> {
    return this.parse(new Blob([html], { type: "text/html" }), `${name}.html`, PAGE_EXTRACTION, false);
  }

  async readImage(bytes: Uint8Array, name: string): Promise<ReadResult> {
    let pdf: Uint8Array;
    try {
      pdf = await imageToPdf(bytes);
    } catch (err) {
      return { ok: false, error: `image not readable: ${(err as Error).message}`, credits: 0 };
    }
    return this.parse(new Blob([pdf as BlobPart], { type: "application/pdf" }), `${name}.pdf`, IMAGE_EXTRACTION, true);
  }

  private async parse(file: Blob, filename: string, extraction: Extraction, ocr: boolean): Promise<ReadResult> {
    if (this.budget < CREDITS_PER_READ) return { ok: false, error: "credit cap reached", credits: 0, capped: true };
    const options = {
      formats: [{ type: "json", schema: extraction.schema, prompt: extraction.prompt }],
      ...(ocr && { parsers: [{ type: "pdf", mode: "ocr" }] }),
    };
    let lastError = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.pace();
      const form = new FormData();
      form.append("file", file, filename);
      form.append("options", JSON.stringify(options));
      let res: Response;
      try {
        res = await fetch(API, { method: "POST", headers: { Authorization: `Bearer ${this.apiKey}` }, body: form, signal: AbortSignal.timeout(120_000) });
      } catch (err) {
        lastError = `network: ${(err as Error).message}`;
        continue;
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        data?: { json?: Record<string, unknown>; metadata?: { creditsUsed?: number } };
      };
      const credits = body.data?.metadata?.creditsUsed ?? 0;
      this.credits += credits;
      this.budget -= credits;
      if (res.status === 429 || res.status >= 500) {
        lastError = `Firecrawl ${res.status}: ${body.error ?? ""}`.trim();
        await sleep(res.status === 429 ? 60_000 : 10_000);
        continue;
      }
      if (!res.ok || !body.data) return { ok: false, error: `Firecrawl ${res.status}: ${body.error ?? "no data"}`, credits };
      if (!body.data.json) return { ok: false, error: "no extraction returned", credits };
      return { ok: true, json: body.data.json, credits };
    }
    return { ok: false, error: lastError, credits: 0 };
  }

  private async pace(): Promise<void> {
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
