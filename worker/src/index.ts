/**
 * Ingestion endpoint: receives Firecrawl Monitor webhooks, pulls the structured
 * extraction for every new/changed page in the check, and commits the result to
 * the data repo as a single commit. Nothing else lives here: no API, no DB.
 */
import { syncToGitHub, type SyncInput } from "../../scripts/sync.ts";
import { checkRefs, fetchChangedPages, verifySignature, type WebhookEvent } from "./firecrawl.ts";

export interface Env {
  FIRECRAWL_WEBHOOK_SECRET: string;
  FIRECRAWL_API_KEY: string;
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
}

// Firecrawl needs a 2xx within 10s. Answer with the real outcome when we can
// (so failures get retried), otherwise acknowledge and finish in the background.
const RESPOND_WITHIN_MS = 8_000;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/webhooks/firecrawl") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const raw = await request.arrayBuffer();
    if (!(await verifySignature(raw, request.headers.get("X-Firecrawl-Signature"), env.FIRECRAWL_WEBHOOK_SECRET))) {
      return new Response("Invalid signature", { status: 401 });
    }

    let event: WebhookEvent;
    try {
      event = JSON.parse(new TextDecoder().decode(raw)) as WebhookEvent;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (event.type !== "monitor.check.completed") {
      return Response.json({ ignored: event.type });
    }

    const work = ingest(event, env);
    ctx.waitUntil(work.catch((err) => console.error("ingest failed", err)));
    const outcome = await Promise.race([
      work.then((r) => ({ done: true as const, ...r })),
      new Promise<{ done: false }>((resolve) => setTimeout(() => resolve({ done: false }), RESPOND_WITHIN_MS)),
    ]).catch((err: unknown) => ({ done: true as const, error: String(err) }));

    if (!outcome.done) return Response.json({ status: "processing" }, { status: 202 });
    if ("error" in outcome) return Response.json({ error: outcome.error }, { status: 500 });
    return Response.json(outcome);
  },
} satisfies ExportedHandler<Env>;

async function ingest(event: WebhookEvent, env: Env) {
  const refs = checkRefs(event);
  const inputs: SyncInput[] = (await Promise.all(refs.map((r) => fetchChangedPages(env.FIRECRAWL_API_KEY, r)))).flat();

  const result = await syncToGitHub(
    { token: env.GITHUB_TOKEN, owner: env.GITHUB_OWNER, repo: env.GITHUB_REPO, branch: env.GITHUB_BRANCH },
    inputs,
    { context: refs.map((r) => `Firecrawl monitor ${r.monitorId} check ${r.checkId}`).join("\n") },
  );

  const summary = {
    commit: result.commitSha,
    pages: inputs.length,
    changes: result.changes,
    skipped: result.skipped,
  };
  console.log(JSON.stringify({ event: event.type, id: event.id, ...summary }));
  return summary;
}
