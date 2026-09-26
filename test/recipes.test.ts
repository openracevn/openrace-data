/**
 * Recipes against saved pages (test/fixtures, fetched 2026-09-24): which pages and
 * images they pick. Free and offline; the paid end-to-end check against a known
 * answer is done by hand (see recipes/README.md).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { cleanContent, pageImages, pageLinks, parseHtml } from "../scripts/lib/html.ts";
import type { Http } from "../scripts/lib/http.ts";
import { actiupRecipe } from "../scripts/lib/recipes/actiup.ts";
import { defaultRecipe, pickPriceImages, pickSubpages } from "../scripts/lib/recipes/default.ts";
import { iraceRecipe } from "../scripts/lib/recipes/irace.ts";
import type { RecipeContext } from "../scripts/lib/recipes/types.ts";
import { vnexpressMarathonRecipe } from "../scripts/lib/recipes/vnexpress-marathon.ts";
import { classifyLink, loadSites } from "../scripts/lib/sites.ts";

const fixture = (name: string) => readFileSync(`test/fixtures/${name}`, "utf8");
const config = loadSites();
const site = (key: string) => config.sites.find((s) => s.key === key)!;

/** Serves fixtures by URL; anything else fails the test. */
function fakeHttp(routes: Record<string, string>): Http & { requested: string[] } {
  const requested: string[] = [];
  const get = (url: string) => {
    requested.push(url);
    const body = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))?.[1];
    if (body === undefined) throw new Error(`unexpected request ${url}`);
    return body;
  };
  return {
    requested,
    text: async (url) => get(url),
    json: async (url) => JSON.parse(get(url)),
    bytes: async () => {
      throw new Error("no images in tests");
    },
  };
}

const ctx = (key: string, http: Http): RecipeContext => ({ site: site(key), config, http, today: "2026-09-24", includePast: false });

describe("actiup recipe", () => {
  it("lists upcoming sports events from the API, in Vietnamese", async () => {
    const http = fakeHttp({ "https://api.actiup.net/v2/content/events/paging": fixture("actiup-listing-0.json") });
    const refs = await actiupRecipe.discover(ctx("actiup", http));
    assert.ok(refs.length > 5);
    // Not over yet: a multi-day event that started before today is still listed.
    const items = JSON.parse(fixture("actiup-listing-0.json")).result.data as { event_slug: string; end_date: string }[];
    const ends = new Map(items.map((e) => [e.event_slug, e.end_date.slice(0, 10)]));
    assert.ok(refs.every((r) => r.url.startsWith("https://actiup.net/vi/event/") && ends.get(r.slugHint!)! >= "2026-09-24"));
    assert.ok(refs.some((r) => r.slugHint === "tet-run-mien-nam-2027"));
  });

  it("leaves out events that are over, unless backfilling", async () => {
    const listing = JSON.stringify({
      result: {
        paging: { total_item: 2 },
        data: [
          { event_slug: "old-race-2025", name: "Old", start_date: "2025-11-01 00:00:00", end_date: "2025-11-01 00:00:00" },
          { event_slug: "new-race-2026", name: "New", start_date: "2026-11-01 00:00:00", end_date: "2026-11-01 00:00:00" },
        ],
      },
    });
    const http = fakeHttp({ "https://api.actiup.net/v2/content/events/paging": listing });
    assert.deepEqual((await actiupRecipe.discover(ctx("actiup", http))).map((r) => r.slugHint), ["new-race-2026"]);
    const backfill = await actiupRecipe.discover({ ...ctx("actiup", http), includePast: true });
    assert.deepEqual(backfill.map((r) => r.slugHint), ["old-race-2025", "new-race-2026"]);
  });

  it("reads Pink Run's facts from the API and offers its price section's images for OCR", async () => {
    const http = fakeHttp({ "https://api.actiup.net/v2/content/events/slug/giai-chay-hong-pink-run-2026": fixture("actiup-event-giai-chay-hong-pink-run-2026.json") });
    const snap = await actiupRecipe.snapshot({ url: "https://actiup.net/vi/event/giai-chay-hong-pink-run-2026", slugHint: "giai-chay-hong-pink-run-2026" }, ctx("actiup", http));
    assert.deepEqual(snap.facts, {
      name: "Giải Chạy Hồng – Pink Run 2026",
      date: "2026-11-01",
      venue: "Celadon City ,Thành Phố Hồ Chí Minh",
      organizer: "Mạng Lưới Ung Thu Vú Việt Nam - BCNV",
      currency: "VND",
      registrationStatus: "open",
      fromPrice: 529000,
    });
    assert.deepEqual(snap.priceImages, [
      "https://pix.actiup.net/2026/07/11/1783767689408581/price-pinkrun26.png",
      "https://pix.actiup.net/2026/07/11/1783767675896934/grouppolicy-pinkrun26.png",
    ]);
    assert.equal(snap.priceImagesCertain, true);
    assert.match(snap.pages[0]!.html, /<h2>Chính sách giá vé<\/h2>/);
    assert.deepEqual(snap.links.map((l) => classifyLink(config, l.url, l.text).kind), ["rules"]);
    assert.equal(snap.hints?.organizer?.id, "mang-luoi-ung-thu-vu-viet-nam-bcnv");
  });
});

describe("vnexpress-marathon recipe", () => {
  it("lists this year's and later race pages from the hub's menu, with their names", async () => {
    const http = fakeHttp({ "https://vm.vnexpress.net/": fixture("vm-home.html") });
    const refs = await vnexpressMarathonRecipe.discover(ctx("vnexpress-marathon", http));
    const hanoi = refs.find((r) => r.url === "https://vm.vnexpress.net/ha-noi-2026");
    assert.equal(hanoi?.name, "Hà Nội 2026");
    assert.ok(refs.every((r) => /-20(2[6-9])$/.test(r.url)));
  });

  it("reads only the banner and the ticket table, not the menu of every edition", async () => {
    const http = fakeHttp({ "https://vm.vnexpress.net/ha-noi-2026": fixture("vm-ha-noi-2026.html") });
    // Checked alone (--race): no name from the hub; the page's own menu gives it.
    const snap = await vnexpressMarathonRecipe.snapshot({ url: "https://vm.vnexpress.net/ha-noi-2026" }, ctx("vnexpress-marathon", http));
    assert.deepEqual(snap.facts, { name: "VnExpress Marathon Hanoi Midnight 2026", date: "2026-11-29", city: "Hà Nội" });
    assert.equal(snap.slugHint, "vnexpress-marathon-ha-noi");
    const html = snap.pages[0]!.html;
    assert.match(html, /NGÀY THI ĐẤU: 29\/11\/2026/);
    assert.match(html, /Super Early Bird/);
    assert.match(html, /1\.350\.000/);
    assert.doesNotMatch(html, /Hải Phòng 2023/);
    assert.deepEqual(snap.hints?.series, { id: "vnexpress-marathon-ha-noi", name: "VnExpress Marathon Hà Nội" });
    assert.equal(snap.hints?.organizer?.id, "vnexpress");
  });

  it("takes the city from the slug when a sponsor prefixes it and the page has no ticket section yet", async () => {
    // long-chau-can-tho-2026: banner names the sponsor ("Long Châu"), not the city,
    // and .ticket-policy isn't published yet — the slug is the only city signal.
    const http = fakeHttp({ "https://vm.vnexpress.net/long-chau-can-tho-2026": fixture("vm-long-chau-can-tho-2026.html") });
    const snap = await vnexpressMarathonRecipe.snapshot({ url: "https://vm.vnexpress.net/long-chau-can-tho-2026" }, ctx("vnexpress-marathon", http));
    assert.deepEqual(snap.facts, { name: "VnExpress Marathon Long Châu Family Day 2026", date: "2026-06-28", city: "Cần Thơ" });
  });
});

describe("irace recipe", () => {
  it("lists races on sale from the home page's cards, with their names", async () => {
    const http = fakeHttp({ "https://ticket.irace.vn/": fixture("irace-home.html") });
    const refs = await iraceRecipe.discover(ctx("irace", http));
    assert.ok(refs.length > 5);
    assert.ok(refs.every((r) => r.url.startsWith("https://ticket.irace.vn/") && r.slugHint));
    const lamdong = refs.find((r) => r.slugHint === "lamdong-trail-2026");
    assert.equal(lamdong?.name, "Giải chạy Lâm Đồng Trail 2026");
    // Chrome, not race cards: my-account, categories, organizer pages.
    assert.ok(refs.every((r) => !/\/(tickets|my-account|categories|organizers|api)(\/|$)/.test(r.url)));
  });

  it("reads Lâm Đồng Trail's price table as text, not an image, plus free facts from its JSON-LD", async () => {
    const http = fakeHttp({ "https://ticket.irace.vn/lamdong-trail-2026": fixture("irace-lamdong-trail-2026.html") });
    const snap = await iraceRecipe.snapshot({ url: "https://ticket.irace.vn/lamdong-trail-2026" }, ctx("irace", http));
    assert.deepEqual(snap.facts, {
      name: "Giải chạy Lâm Đồng Trail 2026",
      venue: "TTC World - Thung Lũng Tình Yêu, số 03-05-07 đường Mai Anh Đào, phường Lâm Viên, Tp. Đà Lạt, Lâm Đồng",
      organizer: "GreenHat | Ban tổ chức sự kiện",
    });
    assert.deepEqual(snap.hints, { organizer: { id: "greenhat", name: "GreenHat | Ban tổ chức sự kiện" } });
    assert.equal(snap.slugHint, "lamdong-trail-2026");
    assert.deepEqual(snap.priceImages, []);
    const html = snap.pages[0]!.html;
    assert.match(html, /Early Bird/);
    assert.match(html, /950\.000đ/);
    // The individual price table (#personal), not group discounts (#group) or the
    // old irace.vn poster images reproduced under "Bảng giá".
    assert.doesNotMatch(html, /Giảm giá/);
    assert.doesNotMatch(html, /<img/);
  });

  it("falls back to #bang-gia's text table once registration closes and #personal is gone", async () => {
    const http = fakeHttp({
      "https://ticket.irace.vn/vnexpress-marathon-grand-tour-nghe-an-2026": fixture("irace-vnexpress-marathon-grand-tour-nghe-an-2026.html"),
    });
    const snap = await iraceRecipe.snapshot({ url: "https://ticket.irace.vn/vnexpress-marathon-grand-tour-nghe-an-2026" }, ctx("irace", http));
    const html = snap.pages[0]!.html;
    assert.match(html, /Super Early Bird/);
    assert.match(html, /340\.000đ/);
    assert.match(html, /920\.000đ/);
  });

  it("reads a race only listed on irace.vn's older su-kien pages, added by hand", async () => {
    const http = fakeHttp({
      "https://irace.vn/su-kien/techcombank-ha-noi-marathon/": fixture("irace-su-kien-techcombank-ha-noi-marathon.html"),
    });
    const snap = await iraceRecipe.snapshot({ url: "https://irace.vn/su-kien/techcombank-ha-noi-marathon/" }, ctx("irace", http));
    // location/organizer are arrays on irace.vn, unlike ticket.irace.vn's single object.
    assert.deepEqual(snap.facts, {
      name: "Techcombank Hanoi International Marathon 2026",
      venue: "Hà Nội",
      organizer: "Sunrise Events Vietnam",
    });
    assert.equal(snap.slugHint, "techcombank-ha-noi-marathon");
    const html = snap.pages[0]!.html;
    assert.match(html, /1\.300\.000đ/);
    assert.match(html, /700\.000đ/);
    // The date, alongside the price table, since it's not in facts (see the ticket.irace.vn test below).
    assert.match(html, /04\/10\/2026/);
  });

  it("falls back to a bare price table if irace.vn's .eventon_desc_in container isn't there", async () => {
    const html = `<!DOCTYPE html><html><body><table><tr><td>5km</td><td>200.000đ</td></tr></table></body></html>`;
    const http = fakeHttp({ "https://irace.vn/su-kien/some-other-race/": html });
    const snap = await iraceRecipe.snapshot({ url: "https://irace.vn/su-kien/some-other-race/" }, ctx("irace", http));
    assert.match(snap.pages[0]!.html, /200\.000đ/);
  });

  it("keeps a link to the same race's ticket.irace.vn page found on its irace.vn su-kien page", async () => {
    const http = fakeHttp({
      "https://irace.vn/su-kien/global-gate-ha-long-esg-marathon/": fixture("irace-su-kien-global-gate-ha-long-esg-marathon.html"),
    });
    const snap = await iraceRecipe.snapshot({ url: "https://irace.vn/su-kien/global-gate-ha-long-esg-marathon/" }, ctx("irace", http));
    assert.ok(snap.links.some((l) => l.url.startsWith("https://ticket.irace.vn/global-gate-ha-long-esg-marathon-2026")));
    const html = snap.pages[0]!.html;
    assert.match(html, /Flash Sale/);
    assert.match(html, /180\.000đ/);
    assert.match(html, /680\.000đ/);
  });
});

describe("default recipe (race sites)", () => {
  it("follows the distance and registration pages from the home page", () => {
    const home = parseHtml(fixture("hcmc-home.html"));
    const picked = pickSubpages(pageLinks(home, "https://hcmcmarathon.com/"), "hcmcmarathon.com", "https://hcmcmarathon.com/");
    for (const page of ["https://hcmcmarathon.com/42km/", "https://hcmcmarathon.com/21km/", "https://hcmcmarathon.com/10km/"]) {
      assert.ok(picked.includes(page), `${page} not in ${picked.join(", ")}`);
    }
    assert.ok(picked.length <= 6);
  });

  it("offers the fee table image on a distance page for OCR, in its largest size", () => {
    const page = parseHtml(fixture("hcmc-21km.html"));
    const images = pickPriceImages(pageImages(page, "https://hcmcmarathon.com/21km/"));
    assert.ok(images.length >= 1);
    assert.match(images[0]!, /HM27-FEE_EN_21KM/);
    assert.doesNotMatch(images[0]!, /-1024x512/);
  });

  it("snapshots a race site: home + subpages, the site's series and organizer, links to other sites", async () => {
    const http = fakeHttp({
      "https://hcmcmarathon.com/21km": fixture("hcmc-21km.html"),
      "https://hcmcmarathon.com/": fixture("hcmc-home.html"),
    });
    const origText = http.text;
    // Subpages we have no fixture for fail, and the recipe carries on without them.
    http.text = async (url) => {
      if (url === "https://hcmcmarathon.com/" || url.startsWith("https://hcmcmarathon.com/21km")) return origText(url);
      throw new Error("404");
    };
    const snap = await defaultRecipe.snapshot({ url: "https://hcmcmarathon.com/" }, ctx("hcmc-marathon", http));
    assert.deepEqual(snap.pages.map((p) => p.url), ["https://hcmcmarathon.com/", "https://hcmcmarathon.com/21km/"]);
    assert.match(snap.pages[1]!.html, /17 January 2027/);
    assert.ok(snap.priceImages.some((u) => /HM27-FEE_EN_21KM/.test(u)));
    assert.equal(snap.priceImagesCertain, true);
    assert.deepEqual(snap.hints, { series: { id: "hcmc-marathon", name: "HCMC Marathon" }, organizer: { id: "pulse-active", name: "Pulse Active", website: "https://pulse.vn/" } });
    assert.ok(snap.links.every((l) => !l.url.includes("hcmcmarathon.com")));
  });

  it("cleans a page to stable HTML: no scripts, menus or forms", () => {
    const html = cleanContent(parseHtml(`<html><body><header><nav>Menu</nav></header><main><h1>Race</h1><script>x()</script><p>21KM <a href="/dang-ky">Đăng ký</a></p><form><input></form><img src="/p.png?ver=1" alt="Bảng giá"></main><footer>©</footer></body></html>`), "https://example.vn/race/");
    assert.equal(html, `<main><h1>Race</h1><p>21KM <a href="https://example.vn/dang-ky">Đăng ký</a></p><img src="https://example.vn/p.png?ver=1" alt="Bảng giá"></main>`);
  });
});

describe("site list", () => {
  it("classifies links: sellers, official sites, Facebook, rules", () => {
    assert.deepEqual(
      [
        "https://ticket.irace.vn/lamdong-trail-2026",
        "https://actiup.net/vi/event/x",
        "https://www.hcmcmarathon.com/",
        "https://www.facebook.com/lamdongtrail",
        "https://docs.google.com/document/d/abc",
        "https://example.com/",
      ].map((u, i) => classifyLink(config, u, i === 4 ? "quy dinh tham du" : "").kind),
      ["seller", "seller", "official", "facebook", "rules", "other"],
    );
  });
});
