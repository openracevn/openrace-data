/**
 * Tells openrace-api that race data changed on main, and which races, so it can
 * resync just those (GET data/races/<id>.json at `after`) and drop removed ones.
 *
 * Payload:
 *   { event: "openrace-data.push", schemaVersion, repository, ref, before, after, pushedAt,
 *     changes: { added: [{id, slug}], updated: [{id, slug, fields}], removed: [{id, slug}] } }
 * `fields` lists the canonical fields that changed; an empty list means only
 * sources/metadata changed (e.g. a new source joined, or a slug was edited).
 *
 * Env: SYNC_WEBHOOK_URL (skipped when unset), BEFORE_SHA, AFTER_SHA, GITHUB_REPOSITORY, GITHUB_REF.
 */
import { raceDiff } from "./lib/changes.ts";
import { env } from "./lib/env.ts";
import { SCHEMA_VERSION } from "./lib/schema.ts";

const url = env("SYNC_WEBHOOK_URL");
if (!url) {
  console.log("SYNC_WEBHOOK_URL not set; skipping API resync notification.");
  process.exit(0);
}

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
    updated: diff.updated.map(({ id, after, fields }) => ({ id, slug: after?.slug ?? null, fields })),
    removed: diff.removed.map(({ id, race }) => ({ id, slug: race?.slug ?? null })),
  },
};

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", "User-Agent": "openrace-data-actions" },
  body: JSON.stringify(payload),
});
if (!res.ok) {
  console.error(`Sync webhook failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const { added, updated, removed } = payload.changes;
console.log(`Notified ${new URL(url).host}: ${added.length} added, ${updated.length} updated, ${removed.length} removed (${payload.before.slice(0, 7)}..${payload.after.slice(0, 7)})`);
