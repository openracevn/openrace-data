# Plan: study 20 ActiUp races (organizers, series, sources)

**For:** an agent working in this repo (Antigravity or similar). **Checked afterwards by:** Claude Code.
**Written:** 2026-09-24. Read `.claude/docs/design-v2.md` first: it explains why we want this.

## Goal

Build a reference of how Vietnam's race market is organized, starting from ActiUp. For 20 races, find out:
- who organizes each race;
- whether it belongs to a recurring series;
- where else it's sold;
- whether it has an official site;
- **where its prices actually are** (text, an image, which section, behind a login).

Someone new to the market should be able to read the output instead of spending days finding all this. It's also the groundwork for the per-site "recipes" in design-v2.

## Rules

- **Free requests only.** Plain HTTP (curl, fetch, a browser) and your own reading of pages and images.
  - **Do not use Firecrawl** or any paid API.
  - Don't read `.env` or use any API key.
- **Research only.** Don't change code, `data/`, `state/`, `schema/` or the workflows. Write only the two output files below. **Don't commit or push.**
- **Record only what you saw, with the URL where you saw it.** When something isn't found, write `not found` and say where you looked. Never guess an organizer, a series or a price. Mark anything inferred as `(inferred: <reason>)`.
- Be polite to the sites: one request at a time, and no crawling of whole sites.

## Step 1: get the event list

ActiUp's public listing API (no auth, undocumented, verified 2026-09-24):

```
GET https://api.actiup.net/v2/content/events/paging?event_type=sports&limit=30&offset=<N>&price=&selling_type=&category_id=&event_time=
```

- `limit` is capped at 30. `offset` is an **item** offset: use 0, 30, 60, ... 300. There are 301 events in total (`result.paging.total_item`). Ignore `paging.current_page`; it's unreliable.
- The results are **not sorted by date**. Fetch all 11 pages and sort them yourself.
- Useful fields per item: `event_slug`, `name`, `start_date`, `end_date`, `min_price`, `selling_type` (`selling` / `sold_out` / ...), `merchant_public_name` (often empty), `short_place`, `categories`.
- The event page is `https://actiup.net/vi/event/<event_slug>`. Use the **Vietnamese** `/vi/` pages. Ignore `/en/` pages and `/vi/event/<id>/tickets` (login wall).

Save the full list to `.claude/docs/study/actiup-events-2026-09-24.json` (the raw API items), so the selection can be checked.

## Step 2: pick 20 races

1. **15 upcoming:** the 15 events with the earliest `start_date` on or after 2026-09-24.
2. **5 past editions of recurring series:** events before 2026-09-24 whose name, without the year, matches an upcoming event or another past event, e.g. an earlier "Standard Chartered Hanoi Marathon", "Tết Run", "Vung Tau City Trail", "Lamdong Trail". Prefer big and well-known series, and prefer ones that also appear among the 15 upcoming.

List the 20 chosen slugs at the top of the output, with the rule that picked each one.

## Step 3: study each race

### 3a. The ActiUp page

Fetch `https://actiup.net/vi/event/<slug>` with plain HTTP. The page is rendered in the browser, but **its data is in the HTML** as an escaped JSON string (Next.js RSC payload):
- `start_date`, `min_price`, `categories`...
- **The description, split into titled sections:** look for `"title":"...","description":"<html>"` pairs. Unescape `\"`, `<` and so on. Example from Pink Run 2026: section `"Chính sách giá vé"` contains `<img src="https://pix.actiup.net/2026/07/11/1783767689408581/price-pinkrun26.png">`.
- Images live on `pix.actiup.net`. Ignore banners and images of **other** events: the page also carries a "related events" list, whose items have their own `event_slug`.
- A browser is fine too, but record what the section titles are.

Record:
- **Section titles**, in order, and which ones hold images.
- **Where the prices are:**
  - text in which section;
  - an image (give the URL and section);
  - only the "Chỉ từ" (from) price;
  - or behind the login.
- **The prices themselves:** open the price image(s) and copy every tier (name, dates, distance, price) exactly as shown. If you can't read images, write `image not read` plus the URL.
- **Organizer** as the page states it (text, logo alt text, "Đơn vị tổ chức", "BTC"...), plus the API's `merchant_public_name`.
- **Date, distances, location** as written.
- **Every outbound link** (not actiup.net): official site, Facebook, other sellers, Google Docs/Drive, Zalo, results.

### 3b. Find the official site and other sellers

In this order, stopping when found:
1. A link on the ActiUp page.
2. A site or fanpage named in the ActiUp text.
3. A normal web search for the race name. **Free search only, no Firecrawl.** Record the query you used.

When an official site is found, fetch it and record:
- its URL;
- **which ticket sellers it links to** (actiup, 5bib, irace, bibchung, enjoysport, timve365, truerace, its own shop...);
- where its prices are: which page, text or image, with the image file names;
- whether it has distance pages (e.g. `/21km/`), a results page, or past editions.

Known example: `lamdongtrail.vn` links to ActiUp, iRace, 5BIB and EnjoySport, while ActiUp's Lâm Đồng Trail page does **not** link back. Record the direction of each link.

### 3c. Series and organizer

- **Series:** does this race recur? Give the other editions you found (year, URL) and where you found them: ActiUp list, official site, news.
- **Organizer:**
  - the company or brand;
  - other races by the same organizer that you've seen in the ActiUp list.

## Output

### File 1: `.claude/docs/study/actiup-20-races.md`

**1. Selection:** the 20 slugs, and why each was picked.

**2. One section per race, in this shape.** Pink Run is shown because its values are already verified, so treat it as the calibration example:

```markdown
### Giải chạy Hồng - Pink Run 2026 (`giai-chay-hong-pink-run-2026`)
- ActiUp: https://actiup.net/vi/event/giai-chay-hong-pink-run-2026
- Date: 2026-11-01, 05:00–09:00 (price image footer) | Location: Celadon Sports & Resort Club, Số 2 đường D2, P. Tân Sơn Nhì, Tân Phú, TP. HCM
- Distances: 3km, 10km
- Organizer: BCNV (logo on price image) | API merchant_public_name: "<value>"
- Series: <name, other editions + URLs, or "none found (looked: ...)">
- Official site: <url or "not found (looked: ...)">
- Other sellers: <list with URLs and link direction>
- Sections: Thông tin sự kiện | Chính sách giá vé [2 images] | Chính sách Hủy... | Thông tin Race-kit [img] | Sơ đồ đường chạy [img] | Giải thưởng [img] | Size áo [img] | Quy định tham dự
- Prices: IMAGE in "Chính sách giá vé": https://pix.actiup.net/2026/07/11/1783767689408581/price-pinkrun26.png
  | Distance | Standard | Super Early Bird 08/7–18/7 | Early Bird 19/7–31/7 | Last call 01/8–20/9 | Late 21/9–05/10 |
  | 3 KM | 569.000 | 459.000 | 479.000 | 529.000 | 569.000 |
  | 10 KM | 799.000 | 629.000 | 679.000 | 749.000 | 799.000 |
  Group prices: IMAGE grouppolicy-pinkrun26.png (same section): <tiers>
- Other links: Google Doc (race rules) https://docs.google.com/document/d/17ET73GwSgE0NX4rHLTHMiK4tfTzeYysU/edit
- Notes: <anything odd>
```

**3. Summary tables:**
- **Organizers:** organizer, races seen (slugs), official site(s).
- **Series:** series, organizer, editions found (year + URL).
- **Sellers / domains:** domain, what it is, how many of the 20 races use it, example URL.
- **Where prices are:** counts of text / image / from-price only / login-only, and which ActiUp section titles held them.
- **Official sites seen:** URL, layout notes (distance pages? price images? file-name patterns?), which sellers it links to.

**4. Surprises and open questions:** anything that contradicts `design-v2.md`, patterns worth a recipe, and races you couldn't figure out.

### File 2: `.claude/docs/study/actiup-events-2026-09-24.json`

The raw API list from step 1.

## Done when

- All 20 races have every field filled or marked `not found (looked: ...)`, with a URL for each claim.
- All price images of the 20 races are either transcribed or marked `image not read` with their URL.
- The summary tables are complete.
- Nothing outside `.claude/docs/study/` was changed, and nothing was committed.

## How Claude Code will check it

- Re-fetch a sample of pages and images, and compare them with what's written. Every price transcription will be checked against its image.
- Confirm that the selection follows step 2.
- Merge lasting findings into `design-v2.md` and `firecrawl.md`, then commit.
