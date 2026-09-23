/**
 * Tells openrace-api that data/ changed on main so it can resync. The API pulls
 * the data itself; this payload only says which commit range to look at.
 *
 * Env: SYNC_WEBHOOK_URL (skipped when unset), BEFORE_SHA, AFTER_SHA, GITHUB_REPOSITORY, GITHUB_REF.
 */
import { env } from "./lib/env.ts";

const url = env("SYNC_WEBHOOK_URL");
if (!url) {
  console.log("SYNC_WEBHOOK_URL not set; skipping API resync notification.");
  process.exit(0);
}

const payload = {
  event: "openrace-data.push",
  repository: env("GITHUB_REPOSITORY") ?? "openracevn/openrace-data",
  ref: env("GITHUB_REF") ?? "refs/heads/main",
  before: env("BEFORE_SHA") ?? null,
  after: env("AFTER_SHA") ?? null,
  pushedAt: new Date().toISOString(),
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
console.log(`Notified ${new URL(url).host}: ${payload.before?.slice(0, 7)}..${payload.after?.slice(0, 7)}`);
