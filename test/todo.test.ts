// Plan 027: the to-do list between the two daily schedules (lib/todo.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IndexEntry } from "../scripts/lib/schema.ts";
import { parseSites } from "../scripts/lib/sites.ts";
import { addTodo, discoverySites, emptyTodo, failTodo, isMonday, isoWeek, parseTodo, readDoneToday, removeTodo, serializeTodo, weeklyPages } from "../scripts/lib/todo.ts";

const config = parseSites(`
monthlyCredits: 900
sites:
  - { key: actiup, name: ActiUp, kind: seller, url: "https://actiup.net/vi/events/sports", recipe: actiup }
  - { key: bibchung, name: bibchung, kind: seller, url: "https://bibchung.pro/events", recipe: none }
  - { key: vnexpress-marathon, name: VnExpress Marathon, kind: hub, url: "https://vm.vnexpress.net/", recipe: vnexpress-marathon }
  - { key: halong-marathon, name: Hạ Long, kind: race-site, url: "https://halongmarathon.com/", recipe: default }
  - { key: androslakesrace, name: Andros, kind: race-site, url: "https://androslakesrace.com/", recipe: none }
`);

const at = "2026-10-15T00:00:00.000Z";

describe("to-do list", () => {
  it("keeps one entry per page, with the strongest reason and its first addedAt and failures", () => {
    const todo = emptyTodo();
    addTodo(todo, { url: "https://a/1", reason: "weekly", addedAt: at });
    failTodo(todo, "https://a/1", "timeout");
    addTodo(todo, { url: "https://a/1", raceId: "r1", reason: "changed", addedAt: "2026-10-16T00:00:00.000Z" });
    addTodo(todo, { url: "https://a/1", reason: "weekly", addedAt: at });
    assert.deepEqual(todo.entries, [{ url: "https://a/1", raceId: "r1", reason: "changed", addedAt: at, failures: 1, lastError: "timeout" }]);
    removeTodo(todo, "https://a/1");
    assert.deepEqual(todo.entries, []);
  });

  it("round-trips through its file, entries sorted by URL", () => {
    const todo = emptyTodo();
    addTodo(todo, { url: "https://b/", reason: "new", addedAt: at });
    addTodo(todo, { url: "https://a/", reason: "new", addedAt: at });
    const back = parseTodo(serializeTodo(todo));
    assert.deepEqual(back.entries.map((e) => e.url), ["https://a/", "https://b/"]);
    assert.deepEqual(parseTodo(null), emptyTodo());
  });

  it("weekly pass: every source page on a site with a recipe, of races not over yet", () => {
    const e = (id: string, date: string, endDate: string | null, sourceUrls: string[]) => ({ id, date, endDate, sourceUrls }) as IndexEntry;
    const index = [
      e("past", "2026-10-01", null, ["https://actiup.net/vi/event/past"]),
      e("today", "2026-10-14", "2026-10-15", ["https://actiup.net/vi/event/now", "https://androslakesrace.com/", "https://unknown.example/"]),
      e("later", "2026-11-01", null, ["https://halongmarathon.com/"]),
    ];
    assert.deepEqual(weeklyPages(index, config, "2026-10-15"), [
      { url: "https://actiup.net/vi/event/now", raceId: "today" },
      { url: "https://halongmarathon.com/", raceId: "later" },
    ]);
  });

  it("discovery lists sellers daily, hubs and race sites on Monday of even ISO weeks", () => {
    assert.deepEqual(isoWeek("2026-10-12"), { weekday: 1, week: 42 });
    assert.deepEqual(isoWeek("2027-01-03"), { weekday: 7, week: 53 });
    assert.equal(isMonday("2026-10-19"), true);
    const keys = (day: string) => discoverySites(config, day).map((s) => s.key);
    assert.deepEqual(keys("2026-10-15"), ["actiup"]);
    assert.deepEqual(keys("2026-10-12"), ["actiup", "vnexpress-marathon", "halong-marathon"]); // week 42
    assert.deepEqual(keys("2026-10-19"), ["actiup"]); // week 43
  });

  it("Schedule 2 runs once a day, after the latest discovery", () => {
    const day = (iso: string) => iso.slice(0, 10);
    const t = (discoveredAt: string | null, readAt: string | null) => ({ ...emptyTodo(), discoveredAt, readAt });
    assert.equal(readDoneToday(t(null, null), "2026-10-17", day), false);
    assert.equal(readDoneToday(t("2026-10-17T01:00:00.000Z", "2026-10-17T02:00:00.000Z"), "2026-10-17", day), true);
    assert.equal(readDoneToday(t("2026-10-17T03:00:00.000Z", "2026-10-17T02:00:00.000Z"), "2026-10-17", day), false); // a late discovery
    assert.equal(readDoneToday(t("2026-10-16T01:00:00.000Z", "2026-10-16T02:00:00.000Z"), "2026-10-17", day), false);
  });
});
