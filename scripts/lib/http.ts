/**
 * Free reads: plain HTTP requests for pages, site APIs and images. Everything a
 * recipe fetches goes through here; only reading content costs Firecrawl credits.
 * Requests to one host are spaced out, and transient failures are retried.
 */
const USER_AGENT = "Mozilla/5.0 (compatible; OpenRaceBot/2.0; +https://openrace.vn)";
const TIMEOUT_MS = 30_000;
const HOST_GAP_MS = 400;

export type Http = {
  text(url: string, headers?: Record<string, string>): Promise<string>;
  json<T = unknown>(url: string, headers?: Record<string, string>): Promise<T>;
  bytes(url: string): Promise<{ bytes: Uint8Array; contentType: string }>;
};

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

export function createHttp(): Http {
  const lastByHost = new Map<string, number>();

  async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
    const host = new URL(url).host;
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const wait = (lastByHost.get(host) ?? 0) + HOST_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastByHost.set(host, Date.now());
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": USER_AGENT, "Accept-Language": "vi,en;q=0.8", ...headers },
          redirect: "follow",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.ok) return res;
        lastError = new HttpError(url, res.status);
        if (res.status < 500 && res.status !== 429) break;
      } catch (err) {
        lastError = err;
      }
      await sleep(attempt * 2_000);
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  return {
    text: async (url, headers) => (await get(url, headers)).text(),
    json: async <T>(url: string, headers?: Record<string, string>) => (await (await get(url, headers)).json()) as T,
    bytes: async (url) => {
      const res = await get(url);
      return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "" };
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
