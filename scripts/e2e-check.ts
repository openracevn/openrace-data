/**
 * The end-to-end check (plan 025): data → API → MCP, against the deployed Workers.
 * Run it after any change to openrace-api, openrace-mcp or the sync: `npm run e2e`.
 *
 * 1. openrace-api is internal: its public URL answers 404 on every read route, and the
 *    sync webhook still answers (401 without X-Sync-Secret, not 404).
 * 2. openrace-mcp is up: /health, /llms.txt, and tools/list has exactly the expected tools.
 * 3. Every MCP tool answers the roadmap questions, in Vietnamese and English, without a
 *    tool error and with results where results must exist.
 * 4. The data made it through: a few races from data/ in this checkout (run it on an
 *    up-to-date main) come back from get_race with the same name and dates, and the
 *    number of races matches data/index.json.
 *
 * No secrets needed, no writes, no credits: about 20 MCP calls (the MCP allows 60/min).
 * Exits 1 when any check fails.
 *
 * Env: E2E_API_URL (default https://openrace-api.bmp.workers.dev),
 *      E2E_MCP_URL (default https://openrace-mcp.bmp.workers.dev).
 */
import { readFileSync } from "node:fs";

import { vietnamDate } from "./lib/state.ts";

const API_URL = (process.env.E2E_API_URL ?? "https://openrace-api.bmp.workers.dev").replace(/\/$/, "");
const MCP_URL = (process.env.E2E_MCP_URL ?? "https://openrace-mcp.bmp.workers.dev").replace(/\/$/, "");

const EXPECTED_TOOLS = [
  "search_races",
  "get_race",
  "list_places",
  "find_series",
  "get_series",
  "find_organizers",
  "get_organizer",
  "get_data_completeness",
];

type IndexEntry = { id: string; slug: string; name: string; date: string; endDate: string | null; lastModified: string };
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const results: { name: string; ok: boolean; detail: string }[] = [];

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    results.push({ name, ok: true, detail: await fn() });
  } catch (err) {
    results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

let rpcId = 0;
async function rpc(method: string, params: Json = {}): Promise<Json> {
  const res = await fetch(`${MCP_URL}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": "openrace-e2e-check" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const text = await res.text();
  assert(res.ok, `${method}: HTTP ${res.status} ${text.slice(0, 200)}`);
  // Streamable HTTP may answer as SSE: the JSON-RPC reply is on the data: line.
  const body = text.trimStart().startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data:"))?.slice(5);
  assert(body, `${method}: no JSON-RPC reply in ${text.slice(0, 200)}`);
  const msg = JSON.parse(body) as Json;
  assert(!msg.error, `${method}: ${JSON.stringify(msg.error)}`);
  return msg.result as Json;
}

/** Calls a tool; fails on a tool error. Returns the parsed JSON the tool sent. */
async function tool(name: string, args: Json = {}): Promise<Json> {
  const result = await rpc("tools/call", { name, arguments: args });
  const text = result.content?.[0]?.text ?? "";
  assert(!result.isError, `${name}(${JSON.stringify(args)}): tool error: ${text.slice(0, 300)}`);
  return (result.structuredContent ?? JSON.parse(text)) as Json;
}

function count(list: unknown, what: string): number {
  assert(Array.isArray(list), `${what}: not a list`);
  return list.length;
}

// 1. The API is internal.
for (const path of ["/", "/races", "/races/search?q=marathon", "/series", "/stats/completeness", "/doc", "/reference"]) {
  await check(`API ${path} is closed`, async () => {
    const res = await fetch(`${API_URL}${path}`);
    assert(res.status === 404, `expected 404, got ${res.status}`);
    assert(!res.headers.get("access-control-allow-origin"), "sends a CORS header");
    return "404";
  });
}
await check("API sync webhook still answers", async () => {
  const res = await fetch(`${API_URL}/internal/sync`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert(res.status === 401, `expected 401 without X-Sync-Secret, got ${res.status}`);
  return "401 without the secret";
});

// 2. The MCP server is up.
await check("MCP /health", async () => {
  const res = await fetch(`${MCP_URL}/health`);
  const body = (await res.json()) as Json;
  assert(res.ok && body.ok, `HTTP ${res.status} ${JSON.stringify(body)}`);
  return `v${body.version}`;
});
await check("MCP /llms.txt", async () => {
  const res = await fetch(`${MCP_URL}/llms.txt`);
  const text = await res.text();
  assert(res.ok, `HTTP ${res.status}`);
  assert(text.includes(`${MCP_URL}/mcp`), "doesn't give the MCP URL");
  assert(text.includes("OpenRace by Perxel"), "no attribution");
  assert(!/openrace-api/.test(text), "mentions the internal API");
  return `${text.length} chars`;
});
await check("MCP tools/list", async () => {
  const names = ((await rpc("tools/list")).tools as Json[]).map((t) => t.name as string).sort();
  assert(JSON.stringify(names) === JSON.stringify([...EXPECTED_TOOLS].sort()), `got ${names.join(", ")}`);
  return `${names.length} tools`;
});

// 3. The roadmap questions, through every tool.
const today = vietnamDate(new Date());
const year = Number(today.slice(0, 4));
const decYear = today.slice(5) > "12-15" ? year + 1 : year;

await check("list_places has Nha Trang and HCMC", async () => {
  const places = (await tool("list_places")).places as Json[];
  const ids = places.map((p) => p.id);
  assert(ids.includes("nha-trang") && ids.includes("hcmc"), `ids: ${ids.join(", ")}`);
  return `${places.length} places`;
});
await check("Nha Trang 1–15/12: races nearby (vi place name)", async () => {
  const r = await tool("search_races", { near: "nha-trang", from: `${decYear}-12-01`, to: `${decYear}-12-15`, when: "all" });
  return `${count(r.races, "races")} races`;
});
// The roadmap asks this after VMM; VMM isn't in the data, so a past Lâm Đồng Trail stands in.
await check("After a trail race: next trail near HCMC, cheapest first", async () => {
  const ref = await tool("search_races", { query: "Lam Dong Trail", when: "past", limit: 1 });
  assert(count(ref.races, "reference race") > 0, "no past Lam Dong Trail found");
  const r = await tool("search_races", { type: "trail_run", after: ref.races[0].id, fromPlace: "hcmc", sort: "price", when: "all" });
  return `after ${ref.races[0].slug}: ${count(r.races, "races")} races`;
});
await check("Races under 300k at today's tier", async () => {
  const r = await tool("search_races", { maxPrice: 300000, sort: "price" });
  return `${count(r.races, "races")} races`;
});
await check("Search in Vietnamese: 'giải chạy Hà Nội'", async () => {
  const r = await tool("search_races", { query: "Hà Nội", when: "all", limit: 5 });
  assert(count(r.races, "races") > 0, "no results");
  return `${r.races.length} races`;
});
await check("Search without diacritics: 'da lat'", async () => {
  const r = await tool("search_races", { query: "da lat", when: "all", limit: 5 });
  assert(count(r.races, "races") > 0, "no results");
  return `${r.races.length} races`;
});
await check("Upcoming races sorted by longest distance", async () => {
  const r = await tool("search_races", { sort: "distance_desc", limit: 5 });
  assert(count(r.races, "races") > 0, "no upcoming races");
  return `${r.races.length} races`;
});
await check("How many times has Lâm Đồng Trail been held?", async () => {
  const found = (await tool("find_series", { name: "Lâm Đồng Trail" })).series as Json[];
  const first = found[0];
  assert(first, "find_series found nothing");
  const s = await tool("get_series", { id: first.id });
  return `${first.id}: ${first.editions?.label ?? JSON.stringify(Object.keys(s))}`;
});
await check("Organizers in HCMC (province 79), then one organizer", async () => {
  const found = (await tool("find_organizers", { province: "79", sort: "most_races" })).organizers as Json[];
  const first = found?.[0];
  assert(first, "find_organizers found nothing");
  const o = await tool("get_organizer", { id: first.id });
  return `${found.length} found; ${first.id} (${Object.keys(o).length} fields)`;
});
await check("Province by name, as people write it: 'Lâm Đồng', 'TP.HCM'", async () => {
  const ld = await tool("search_races", { province: "Lâm Đồng", when: "all", limit: 1 });
  const hcm = await tool("find_organizers", { province: "TP.HCM" });
  assert(ld.pagination?.total > 0, "no races for province 'Lâm Đồng'");
  assert(count(hcm.organizers, "organizers") > 0, "no organizers for province 'TP.HCM'");
  return `Lâm Đồng: ${ld.pagination.total} races; TP.HCM: ${hcm.organizers.length} organizers`;
});
await check("Organizer by name: 'VnExpress'", async () => {
  const found = (await tool("find_organizers", { name: "VnExpress" })).organizers as Json[];
  return `${count(found, "organizers")} found`;
});

// 4. The data made it through.
const index = JSON.parse(readFileSync("data/index.json", "utf8")) as IndexEntry[];
await check("How complete is the data? Race count matches data/index.json", async () => {
  const c = await tool("get_data_completeness");
  assert(typeof c.score === "number", "no score");
  // The snapshot is daily: allow it to trail main by a few races.
  assert(Math.abs(c.races - index.length) <= 5, `snapshot ${c.day} has ${c.races} races, data/index.json has ${index.length}`);
  return `score ${c.score}, ${c.races} races on ${c.day} (index: ${index.length})`;
});
const byModified = [...index].sort((a, b) => b.lastModified.localeCompare(a.lastModified));
const upcoming = index.filter((r) => (r.endDate ?? r.date) >= today).sort((a, b) => a.date.localeCompare(b.date));
const samples = [...new Map([byModified[0], upcoming[0], index[Math.floor(index.length / 2)]].filter((r): r is IndexEntry => r !== undefined).map((r) => [r.id, r] as const)).values()];
for (const race of samples) {
  await check(`get_race ${race.slug} matches its file`, async () => {
    const r = await tool("get_race", { idOrSlug: race.slug });
    const got = (r.race ?? r) as Json;
    for (const key of ["id", "name", "date", "endDate"] as const) {
      assert((got[key] ?? null) === (race[key] ?? null), `${key}: MCP ${JSON.stringify(got[key])}, file ${JSON.stringify(race[key])}`);
    }
    return `${race.date}${race.endDate ? `..${race.endDate}` : ""}, freshness ${JSON.stringify(got.freshness?.status ?? got.freshness ?? null)}`;
  });
}

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.name.padEnd(width)}  ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed (API ${API_URL}, MCP ${MCP_URL}).`);
if (failed > 0) process.exit(1);
