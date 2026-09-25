import assert from "node:assert/strict";
import { test } from "node:test";
import { hostOf } from "../scripts/lib/sites.ts";

test("hostOf", async (t) => {
  await t.test("returns the plain host for an ordinary URL", () => {
    assert.equal(hostOf("https://www.actiup.net/vi/events/sports"), "actiup.net");
  });

  await t.test("unwraps a Wayback Machine snapshot to the site it archived", () => {
    assert.equal(hostOf("http://web.archive.org/web/20210625025336/https://www.123go.vn/lakesrace"), "123go.vn");
    assert.equal(hostOf("https://web.archive.org/web/20250212015802if_/https://androslakesrace.com/previous-editions.html"), "androslakesrace.com");
  });

  await t.test("falls back to archive.org itself if the snapshot path can't be parsed", () => {
    assert.equal(hostOf("https://web.archive.org/"), "web.archive.org");
  });
});
