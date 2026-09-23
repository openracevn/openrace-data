import type { SyncInput } from "../../scripts/sync.ts";

const API_BASE = "https://api.firecrawl.dev/v2";

// Shapes per https://docs.firecrawl.dev/webhooks/events and the v2 OpenAPI spec
// (MonitorCheckDetailResponse / MonitorCheckPage). Only the fields we use.
export type WebhookEvent = {
  success: boolean;
  type: string;
  id: string;
  webhookId?: string;
  data: unknown;
  metadata?: Record<string, unknown>;
  error?: string;
};

type CheckRef = { monitorId: string; checkId: string };

type MonitorCheckPage = {
  url: string;
  status: "same" | "new" | "changed" | "removed" | "error";
  snapshot?: { json?: Record<string, unknown> } | null;
  createdAt?: string;
};

type MonitorCheckDetailResponse = {
  success: boolean;
  next?: string | null;
  data: { finishedAt?: string | null; pages?: MonitorCheckPage[]; next?: string | null };
};

/**
 * Firecrawl signs the raw body with HMAC-SHA256 using the account webhook secret
 * and sends `X-Firecrawl-Signature: sha256=<hex>`. `crypto.subtle.verify` does
 * the comparison in constant time.
 */
export async function verifySignature(rawBody: ArrayBuffer, header: string | null, secret: string): Promise<boolean> {
  if (!header || !secret) return false;
  const [algorithm, hex] = header.split("=", 2);
  if (algorithm !== "sha256" || !hex || !/^[0-9a-f]{64}$/i.test(hex)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signature = Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
  return crypto.subtle.verify("HMAC", key, signature, rawBody);
}

/** `monitor.check.completed` carries check IDs only; the docs show `data` as an array, the schema as an object. */
export function checkRefs(event: WebhookEvent): CheckRef[] {
  const items = Array.isArray(event.data) ? event.data : [event.data];
  return items.filter(
    (d): d is CheckRef =>
      typeof d === "object" && d !== null && typeof (d as CheckRef).monitorId === "string" && typeof (d as CheckRef).checkId === "string",
  );
}

/**
 * Fetches the check's new/changed pages and returns each page's JSON-mode
 * extraction snapshot. Pages without a snapshot (e.g. the monitor was set up
 * without a `changeTracking` json format) are skipped.
 */
export async function fetchChangedPages(apiKey: string, ref: CheckRef): Promise<SyncInput[]> {
  const inputs: SyncInput[] = [];
  for (const status of ["new", "changed"] as const) {
    let url: string | null =
      `${API_BASE}/monitor/${encodeURIComponent(ref.monitorId)}/checks/${encodeURIComponent(ref.checkId)}?status=${status}&limit=100`;
    while (url) {
      const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!res.ok) throw new Error(`Firecrawl GET ${url} -> ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as MonitorCheckDetailResponse;
      const fallbackTime = body.data.finishedAt ?? new Date().toISOString();
      for (const page of body.data.pages ?? []) {
        const json = page.snapshot?.json;
        if (page.status !== status || !json) continue;
        inputs.push({ url: page.url, extracted: json, checkedAt: page.createdAt ?? fallbackTime });
      }
      url = body.next ?? body.data.next ?? null;
    }
  }
  return inputs;
}
