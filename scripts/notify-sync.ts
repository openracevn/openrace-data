/**
 * Tells openrace-api that race data changed on main, and which races, so it can
 * resync. The API reads the whole data/races tree at the branch head itself (files are named
 * <slug>.json; it maps them to ids through data/index.json), so `changes` is informational.
 *
 * Payload:
 *   { event: "openrace-data.push", schemaVersion, repository, ref, before, after, pushedAt,
 *     changes: { added: [{id, slug}], updated: [{id, slug, fields}], removed: [{id, slug}] } }
 * `fields` lists the canonical fields that changed; an empty list means only
 * sources/metadata changed (e.g. a new source joined, or a slug was edited; then
 * `renamedFrom` is the old slug).
 *
 * The API authenticates with the X-Sync-Secret header, then pulls the changed files
 * itself, at most SYNC_MAX_FETCH per call. Its reply says how many are `remaining`,
 * so this repeats the call until that reaches 0. Files the API rejected (`errors`)
 * fail the job: they passed our validation and the API tolerates new fields and enum
 * values, so a rejection means a breaking change the API hasn't caught up with.
 *
 * Env: SYNC_WEBHOOK_URL (skipped when unset), SYNC_SECRET (required with the URL),
 *      BEFORE_SHA, AFTER_SHA, GITHUB_REPOSITORY, GITHUB_REF.
 */
import { raceDiff } from "./lib/changes.ts";
import { env, requireEnv } from "./lib/env.ts";
import { SCHEMA_VERSION } from "./lib/schema.ts";

const url = env("SYNC_WEBHOOK_URL");
if (!url) {
  console.log("SYNC_WEBHOOK_URL not set; skipping API resync notification.");
  process.exit(0);
}
const secret = requireEnv("SYNC_SECRET");
// Each call downloads up to SYNC_MAX_FETCH files (40 by default), so this covers thousands.
const MAX_CALLS = 50;

type SyncResult = {
  inserted: number;
  updated: number;
  restored: number;
  unchanged: number;
  removed: number;
  remaining: number;
  errors: { file: string; message: string }[];
};

const diff = raceDiff(env("BEFORE_SHA"), env("AFTER_SHA"));
const payload = {
  event: "openrace-data.push",
  schemaVersion: SCHEMA_VERSION,
  repository: env("GITHUB_REPOSITORY") ?? "openracevn/openrace-data",
  ref: env("GITHUB_REF") ?? "refs/heads/main",
  before: diff.before,
  after: diff.after,
  pushedAt: new Date().toISOString(),
  changes: {
    added: diff.added.map(({ id, race }) => ({ id, slug: race?.slug ?? null })),
    updated: diff.updated.map(({ id, before, after, fields }) => ({
      id,
      slug: after?.slug ?? null,
      fields,
      ...(before && after && before.slug !== after.slug && { renamedFrom: before.slug }),
    })),
    removed: diff.removed.map(({ id, race }) => ({ id, slug: race?.slug ?? null })),
  },
};

const totals = { inserted: 0, updated: 0, restored: 0, removed: 0 };
const errors = new Map<string, string>();
let result: SyncResult | undefined;

for (let call = 1; call <= MAX_CALLS; call++) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "openrace-data-actions",
      "X-Sync-Secret": secret,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error(`Sync webhook failed on call ${call}: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  result = (await res.json()) as SyncResult;
  totals.inserted += result.inserted;
  totals.updated += result.updated;
  totals.restored += result.restored;
  totals.removed += result.removed;
  // Rejected files are re-downloaded on every call, so keep the latest message per file.
  for (const e of result.errors) errors.set(e.file, e.message);
  console.log(
    `Call ${call}: ${result.inserted} inserted, ${result.updated} updated, ${result.restored} restored, ` +
      `${result.removed} removed, ${result.unchanged} unchanged, ${result.remaining} remaining`,
  );
  if (result.remaining === 0) break;
}

const { added, updated, removed } = payload.changes;
console.log(
  `Notified ${new URL(url).host}: ${added.length} added, ${updated.length} updated, ${removed.length} removed ` +
    `(${payload.before.slice(0, 7)}..${payload.after.slice(0, 7)}). ` +
    `API wrote ${totals.inserted} inserted, ${totals.updated} updated, ${totals.restored} restored, ${totals.removed} removed.`,
);

if (result && result.remaining > 0) {
  console.error(`API still has ${result.remaining} files to sync after ${MAX_CALLS} calls; the next push will continue.`);
  process.exit(1);
}
if (errors.size > 0) {
  console.error(`API rejected ${errors.size} file(s) that passed validate here (breaking change not yet handled by the API?):`);
  for (const [file, message] of errors) console.error(`  ${file}: ${message}`);
  process.exit(1);
}
