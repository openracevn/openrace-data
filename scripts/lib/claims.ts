/**
 * Claims (plan 019): before working on a race or series, a unit claims its id so a second
 * session skips it. One file per id in the shared claims folder, created with the "wx"
 * flag so two sessions racing for the same id can't both win. A claim expires after a
 * timeout, so a crashed session doesn't block the id forever.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CLAIM_TTL_MS = 2 * 60 * 60 * 1000;

export type Claim = { id: string; unit: string; at: string };
export type ClaimResult = { id: string; ok: true } | { id: string; ok: false; heldBy: string; since: string };

const fileFor = (dir: string, id: string) => join(dir, `${id.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);

function readClaim(path: string): Claim | null {
  try {
    const c = JSON.parse(readFileSync(path, "utf8")) as Claim;
    return typeof c.unit === "string" && typeof c.at === "string" ? c : null;
  } catch {
    return null;
  }
}

const expired = (c: Claim | null, now: number, ttl: number) => c === null || now - Date.parse(c.at) > ttl;

/** Claim each id for `unit`. An id the same unit already holds is refreshed; an expired or unreadable claim is taken over. */
export function claimAll(dir: string, unit: string, ids: readonly string[], now = Date.now(), ttl = CLAIM_TTL_MS): ClaimResult[] {
  mkdirSync(dir, { recursive: true });
  return ids.map((id): ClaimResult => {
    const path = fileFor(dir, id);
    const body = JSON.stringify({ id, unit, at: new Date(now).toISOString() } satisfies Claim);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        writeFileSync(path, body, { flag: "wx" });
        return { id, ok: true };
      } catch {
        const held = readClaim(path);
        if (held && held.unit === unit) {
          writeFileSync(path, body);
          return { id, ok: true };
        }
        if (!expired(held, now, ttl)) return { id, ok: false, heldBy: held!.unit, since: held!.at };
        rmSync(path, { force: true }); // stale: take it over on the next attempt
      }
    }
    const held = readClaim(path);
    return { id, ok: false, heldBy: held?.unit ?? "unknown", since: held?.at ?? "" };
  });
}

/** Release every claim `unit` holds (all of them, so a unit needn't remember its ids). */
export function releaseUnit(dir: string, unit: string): string[] {
  if (!existsSync(dir)) return [];
  const released: string[] = [];
  for (const f of readdirSync(dir)) {
    const c = readClaim(join(dir, f));
    if (c?.unit === unit) {
      rmSync(join(dir, f), { force: true });
      released.push(c.id);
    }
  }
  return released;
}

export function listClaims(dir: string, now = Date.now(), ttl = CLAIM_TTL_MS): (Claim & { stale: boolean })[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const c = readClaim(join(dir, f));
    return c ? [{ ...c, stale: expired(c, now, ttl) }] : [];
  });
}
