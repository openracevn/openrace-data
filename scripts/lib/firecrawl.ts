/**
 * Minimal Firecrawl v2 scrape client. Requests are sequential and spaced out to
 * stay under the plan's rate limit (about 10/min on the current plan); a 429 or
 * 5xx is retried after a pause.
 */
import type { Extraction } from "./extraction.ts";

const API = "https://api.firecrawl.dev/v2/scrape";

export type ScrapeResult =
  | { ok: true; links: string[]; json: Record<string, unknown> | null; credits: number }
  | { ok: false; error: string; credits: number };

export class Firecrawl {
  private lastRequestAt = 0;
  credits = 0;

  constructor(
    private readonly apiKey: string,
    private readonly minIntervalMs = 6_500,
  ) {}

  /** Links only (1 credit). */
  links(url: string): Promise<ScrapeResult> {
    return this.scrape(url, ["links"]);
  }

  /** Race extraction with the source's schema and prompt (5 credits: 1 + 4 for JSON). */
  extract(url: string, extraction: Extraction): Promise<ScrapeResult> {
    return this.scrape(url, [{ type: "json", ...extraction }]);
  }

  private async scrape(url: string, formats: unknown[]): Promise<ScrapeResult> {
    let lastError = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.pace();
      let res: Response;
      try {
        res = await fetch(API, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          // maxAge 0: always a live fetch, never Firecrawl's cache. waitFor: ActiUp renders client-side.
          body: JSON.stringify({ url, formats, waitFor: 2000, maxAge: 0 }),
        });
      } catch (err) {
        lastError = `network: ${(err as Error).message}`;
        continue;
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        data?: { links?: string[]; json?: Record<string, unknown>; metadata?: { creditsUsed?: number; statusCode?: number } };
      };
      const credits = body.data?.metadata?.creditsUsed ?? 0;
      this.credits += credits;
      if (res.status === 429 || res.status >= 500) {
        lastError = `Firecrawl ${res.status}: ${body.error ?? ""}`.trim();
        await sleep(res.status === 429 ? 60_000 : 10_000);
        continue;
      }
      if (!res.ok || !body.data) return { ok: false, error: `Firecrawl ${res.status}: ${body.error ?? "no data"}`, credits };
      const status = body.data.metadata?.statusCode;
      if (status && status >= 400) return { ok: false, error: `page returned HTTP ${status}`, credits };
      return { ok: true, links: body.data.links ?? [], json: body.data.json ?? null, credits };
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
