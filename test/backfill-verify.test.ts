import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { htmlToText, numbersIn, verifyCandidate, type Page } from "../scripts/lib/backfill-verify.ts";

const page = (title: string, text: string, ok = true): Page => ({ ok, status: ok ? 200 : 404, title, text });
const cand = (over: Partial<{ count: number; quote: string; url: string }> = {}) => ({ race: "x", url: "https://news.example/a", count: 9100, quote: "Khoảng 9.100 người tham gia", ...over });
const bodyOk = page("Marathon 2023", "Khoảng 9.100 người tham gia giải năm 2023");

describe("backfill verify", () => {
  it("reads numbers with any thousands separator", () => {
    assert.deepEqual(numbersIn("15.000 và 13,117, 15 000 VĐV, 2000"), [15000, 13117, 15000, 2000]);
  });
  it("accepts a verbatim quote on the right edition", () => {
    assert.deepEqual(verifyCandidate(cand(), "2023", bodyOk), { ok: true, quote: "Khoảng 9.100 người tham gia" });
  });
  it("rejects a wrong edition, a dead link, Facebook", () => {
    assert.equal(verifyCandidate(cand(), "2019", bodyOk).ok, false);
    assert.equal(verifyCandidate(cand(), "2023", page("", "", false)).ok, false);
    assert.equal(verifyCandidate(cand({ url: "https://www.facebook.com/x" }), "2023", bodyOk).ok, false);
  });
  it("rejects a quote that isn't on the page or doesn't hold the count", () => {
    assert.equal(verifyCandidate(cand({ quote: "Khoảng 9.100 người chạy" }), "2023", bodyOk).ok, false);
    assert.equal(verifyCandidate(cand({ count: 9000 }), "2023", bodyOk).ok, false);
  });
  it("rejects targets, capacity and finishers", () => {
    for (const quote of ["dự kiến 9.100 người tham gia", "giới hạn 9.100 slot", "9.100 finishers"]) {
      assert.equal(verifyCandidate(cand({ quote }), "2023", page("t 2023", quote)).ok, false, quote);
    }
  });
  it("without a quote the count must be on the page, and the result has no quote", () => {
    assert.deepEqual(verifyCandidate({ ...cand(), quote: undefined }, "2023", bodyOk), { ok: true, quote: null });
    assert.equal(verifyCandidate({ ...cand({ count: 7 }), quote: undefined }, "2023", bodyOk).ok, false);
  });
  it("strips tags, scripts and entities", () => {
    const { title, text } = htmlToText("<title>A &amp; B</title><script>x=9100</script><p>hơn&nbsp;9.100 <b>người</b></p>");
    assert.equal(title, "A & B");
    assert.equal(text.trim(), "hơn 9.100 người");
  });
});
