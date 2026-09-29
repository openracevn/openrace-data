// Compare two agent readings (read.json from worker A, read-b.json from worker B) per race.
// Usage: node .claude/skills/update-race/refs/opencode-read/compare.mjs .agent-read
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? ".agent-read";

const load = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const dist = (s) => norm(s).replace(/\s/g, "").toUpperCase();
const set = (xs) => new Set((xs ?? []).map(String));
const priceKey = (p) =>
  [dist(p.distance), norm(p.tier), Number(p.price), p.from ?? "", p.to ?? "", norm(p.audience)].join(" | ");
// Loose key: same amount for the same row, ignoring spacing, accents and whether a year was added to a date.
const loose = (s) => norm(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const dayMonth = (d) => {
  if (!d) return "";
  const iso = String(d).match(/^\d{4}-(\d{2})-(\d{2})$/);
  const [dd, mm] = iso ? [iso[2], iso[1]] : String(d).split("/");
  return `${Number(dd)}/${Number(mm)}`;
};
const looseKey = (p) =>
  [loose(p.distance), loose(p.tier), Number(p.price), dayMonth(p.from), dayMonth(p.to), loose(p.audience)].join(" | ");
const sameLoose = (a, b) => {
  const k = (xs) => (xs ?? []).map(looseKey).sort().join("\n");
  return k(a) === k(b);
};

// Items in a but not in b, and in b but not in a.
function diff(a, b) {
  const onlyA = [...a].filter((x) => !b.has(x));
  const onlyB = [...b].filter((x) => !a.has(x));
  return onlyA.length || onlyB.length ? { onlyA, onlyB } : null;
}

function comparePage(a, b) {
  const out = [];
  if (a.pageKind !== b.pageKind) out.push(`pageKind: A=${a.pageKind} B=${b.pageKind}`);
  for (const [field, f] of [["types", String], ["distances", dist]]) {
    const d = diff(new Set((a[field] ?? []).map(f)), new Set((b[field] ?? []).map(f)));
    if (d) out.push(`${field}: A only [${d.onlyA}] B only [${d.onlyB}]`);
  }
  const d = diff(new Set((a.prices ?? []).map(priceKey)), new Set((b.prices ?? []).map(priceKey)));
  if (d && sameLoose(a.prices, b.prices)) out.push("prices: format only");
  else if (d) out.push(`prices: A only [${d.onlyA.join("; ")}] B only [${d.onlyB.join("; ")}]`);
  return out;
}

function compareImage(a, b) {
  const d = diff(new Set((a.prices ?? []).map(priceKey)), new Set((b.prices ?? []).map(priceKey)));
  if (!d) return [];
  if (sameLoose(a.prices, b.prices)) return [`  format only (${d.onlyA.length} rows: spacing, accents or a year added); same amounts. Keep the one that follows the rules`];
  return [
    ...d.onlyA.map((x) => `  A only: ${x}`),
    ...d.onlyB.map((x) => `  B only: ${x}`),
  ];
}

// Price tables are grids: a distance missing a tier that other distances have is likely a skipped cell.
function gridGaps(who, prices) {
  const tiers = new Set((prices ?? []).map((p) => loose(p.tier)));
  const byDist = new Map();
  for (const p of prices ?? []) byDist.set(dist(p.distance), (byDist.get(dist(p.distance)) ?? new Set()).add(loose(p.tier)));
  if (byDist.size < 2 || tiers.size < 2) return [];
  return [...byDist].filter(([, t]) => t.size < tiers.size).map(([d, t]) => `  grid gap (${who}): ${d} has ${t.size} of ${tiers.size} tiers`);
}

const counts = { OK: 0, FORMAT: 0, DIFF: 0, MISSING: 0 };
for (const race of readdirSync(root).filter((d) => /^\d+-/.test(d)).sort()) {
  const A = load(join(root, race, "read.json"));
  const B = load(join(root, race, "read-b.json"));
  const lines = [];
  let missing = false;
  let formatOnly = 0;

  (A?.pages ?? []).forEach((pa, i) => {
    const pb = B?.pages?.[i];
    if (!pa.json || !pb?.json) {
      missing = true;
      lines.push(`page-${i + 1}: ${!pa.json ? "A" : ""}${!pb?.json ? "B" : ""} not read`);
    } else comparePage(pa.json, pb.json).forEach((l) => lines.push(`page-${i + 1} ${l}`));
  });

  (A?.images ?? []).forEach((ia, i) => {
    const ib = B?.images?.[i];
    const file = `view-image-${i + 1}.jpg`;
    if (!ia.json || !ib?.json) {
      missing = true;
      lines.push(`${file}: ${!ia.json ? "A" : ""}${!ib?.json ? "B" : ""} not read`);
    } else {
      const d = compareImage(ia.json, ib.json);
      const gaps = [...gridGaps("A", ia.json.prices), ...gridGaps("B", ib.json.prices)];
      if (gaps.length) lines.push(`${file}: check the grid (group or relay rows may be fine)`, ...gaps);
      if (d.length) lines.push(`${file}: prices differ`, ...d);
      if (d.length && d[0].includes("format only")) formatOnly++;
    }
  });

  const real = lines.filter((l) => !/format only/.test(l) && !/^view-image-\d+\.jpg: (prices differ|check the grid.*)$/.test(l)).length;
  const status = missing ? "MISSING" : real ? "DIFF" : lines.length ? "FORMAT" : "OK";
  counts[status]++;
  console.log(`${status.padEnd(7)} ${race}`);
  lines.forEach((l) => console.log(`        ${l}`));
}
console.log(`\n${counts.OK} OK, ${counts.FORMAT} FORMAT (same amounts), ${counts.DIFF} DIFF, ${counts.MISSING} MISSING`);
