# ActiUp 20 Races Study — 2026-09-24

> **Review by Claude Code (2026-09-24).** The study follows the plan (`.claude/plans/001-2026-09-24-actiup-20-races-study.md`): 15 upcoming races and 5 past editions, every field filled or marked. Spot-checked against ActiUp's API and the image hosts. Corrections:
>
> 1. **ActiUp does link to official sites sometimes.** VPBank Hanoi (`vpbankmarathon.com/quy-dinh`) and Salonpas (`salonpasrun.vn/...`) link from their rules section. Lâm Đồng Trail does **not** link to `lamdongtrail.vn`; its only outside link is a Google Drive file. So Surprise 7 ("only Salonpas") and Open question 3 are wrong.
> 2. **The `$17` "unresolved reference" (Aqua Warriors) isn't a problem.** It's a reference inside Next.js page data. ActiUp's event API (`/v2/content/events/slug/<slug>`, which the recipe uses) returns the full section: "Giá vé" is 6,394 characters. Open question 1 is closed.
> 3. **`pix.raceez.com` images still load** (JPEG/PNG, no file extension). The recipe detects the format from the bytes, so past editions' price images are readable.
> 4. **Vietnam International Half Marathon dates:** the 2024 edition is 2024-01-01. The 2025 and 2026 editions both say 2026-01-01, so one of them is wrong on ActiUp. Not all three, as stated.
> 5. **Organizer names:** the API's `merchant.merchant_name` has the short name ("GreenHat", "VIET JUNGLE", "GEMADEPT") even when `merchant_public_name` is empty. The ActiUp recipe now uses it.
> 6. The "Where prices are" counts add up to 21, not 20.
> 7. **Not verified:** organizers, sellers and official sites found only by web search, and 19 of 20 price images (only Pink Run's was read). Treat them as leads.
>
> **Merged:**
> - Sellers pace8 and cticket, and the 9 official race sites found here, are now in `config/sites.yaml`. The race sites are recognized in links but not read until each has a paid check.
> - The organizer name now comes from `merchant_name`.
>
> **Idea for later:** ActiUp slugs share a stem across years (`dalat-ultra-trail-2024/2025/2026`, `aqua-warriors-halong-bay-*`), which is a free way to detect series.

> All data fetched from live pages on 2026-09-24. Sources noted per claim.
> Images read directly by the agent. Web searches noted with query used.

---

## 1. Selection

**15 upcoming** (earliest `start_date` ≥ 2026-09-24, from sorted API list):

| # | Slug | start_date | Rule |
|---|------|-----------|------|
| 1 | `test-run-2026-speed-your-pr` | 2026-09-27 | Upcoming #1 |
| 2 | `the-5th-edition-of-the-techcombank-hanoi-international-marathon` | 2026-10-04 | Upcoming #2 |
| 3 | `kun-fun-run-dong-thap-2026-keyshop` | 2026-10-09 | Upcoming #3 |
| 4 | `vpbank-dat-sen-hong-music-marathon-2026` | 2026-10-09 | Upcoming #4 |
| 5 | `global-gate-halong-esg-marathon-2026` | 2026-10-10 | Upcoming #5 |
| 6 | `gemadept-run-hai-phong-city-2026` | 2026-10-10 | Upcoming #6 |
| 7 | `lao-cai-marathon-2026-dong-chay-bien-cuong` | 2026-10-18 | Upcoming #7 |
| 8 | `vpbank-hanoi-international-marathon-2026` | 2026-10-18 | Upcoming #8 |
| 9 | `gemadept-run-the-way-forward-2026` | 2026-10-24 | Upcoming #9 |
| 10 | `gia-lai-city-trail-giac-mo-dai-ngan-2026` | 2026-10-30 | Upcoming #10 |
| 11 | `fv-run` | 2026-10-31 | Upcoming #11 |
| 12 | `giai-chay-hong-pink-run-2026` | 2026-11-01 | Upcoming #12 |
| 13 | `lamdong-trail-2026` | 2026-11-06 | Upcoming #13 |
| 14 | `salonpas-run-2026` | 2026-11-07 | Upcoming #14 |
| 15 | `standard-chartered-hanoi-marathon-heritage-race-2026` | 2026-11-07 | Upcoming #15 |

**5 past editions of recurring series** (before 2026-09-24; name matches another edition in the 301-event list):

| # | Slug | start_date | Series match |
|---|------|-----------|------|
| 16 | `giai-ban-marathon-quoc-te-viet-nam-2024` | 2024-01-01 | "Vietnam International Half Marathon powered by Herbalife" — 2025 + 2026 editions in list |
| 17 | `minh-dam-discovery-marathon-2024` | 2024-02-25 | "Minh Đạm Discovery Marathon" — 2025 edition in list |
| 18 | `dalat-ultra-trail-2024` | 2024-03-15 | "Dalat Ultra Trail" — 2025 + 2026 editions in list; organizer Vietnam MTB Series |
| 19 | `chay-vi-trai-tim-2024` | 2024-03-23 | "Run for the Heart / Chạy Vì Trái Tim" — 2026 edition in list |
| 20 | `aqua-warriors-halong-bay-2024` | 2024-04-14 | "Aqua Warriors Halong Bay" — 2025 + 2026 editions in list |

---

## 2. Race entries

### TEST RUN 2026 - SPEED YOUR PR (`test-run-2026-speed-your-pr`)
- **ActiUp:** https://actiup.net/vi/event/test-run-2026-speed-your-pr
- **Date:** 2026-09-27, 04:00–08:30 | **Location:** SOHO Park – The Global City, Binh Trung Ward, TP. HCM
- **Distances:** 5km, 10km (source: web search — Facebook posts by Nexus Sport Events)
- **Organizer:** Nexus Sport Events + VNMS Running Hub (source: web search, Facebook) | API merchant_public_name: `"DA HAE INTERNATIONAL CO., LTD"` (inferred: likely payment entity, not actual organizer)
- **Series:** none found — name "TEST RUN" appears unique in ActiUp list (looked: ActiUp 301-event JSON)
- **Official site:** not found (looked: ActiUp page outbound links — none non-actiup; web search "TEST RUN 2026 SPEED YOUR PR" — only Facebook results)
- **Other sellers:** not found (looked: ActiUp page + web search)
- **Sections:** Thông tin sự kiện | Chính sách giá vé | Size áo | Chính sách Hủy - Chuyển nhượng - Thay đổi thông tin cá nhân/ cự ly | Quy định tham dự
- **Prices:** IMAGE in "Chính sách giá vé": https://pix.actiup.net/2026/09/09/1788920254044328/Price-list-(1).png — `image not read` (file fetched but price table requires reading)
- **Other links:** none
- **Notes:** API `merchant_public_name` is `"DA HAE INTERNATIONAL CO., LTD"` but web search identifies organizers as Nexus Sport Events + VNMS Running Hub — the merchant field may be a ticketing company. Sold out or near-race date by study time.

---

### Giải Marathon Quốc tế Hà Nội Techcombank Mùa thứ 5 (`the-5th-edition-of-the-techcombank-hanoi-international-marathon`)
- **ActiUp:** https://actiup.net/vi/event/the-5th-edition-of-the-techcombank-hanoi-international-marathon
- **Date:** 2026-10-04 | **Location:** Hà Nội, Việt Nam
- **Distances:** 42km, 21km, 10km, 5km, Kids Run 3km + 1.5km (source: web search → marathonhn.com)
- **Organizer:** Sunrise Events Vietnam (SEV) + Techcombank (source: web search, marathonhn.com) | API merchant_public_name: `""` (empty)
- **Series:** Techcombank Hanoi International Marathon — recurring annual series; editions in ActiUp list: `the-5th-edition-of-the-techcombank-hanoi-international-marathon` (2026); earlier editions not found in ActiUp 301-event list (looked: ActiUp JSON, searching "techcombank" and "hanoi marathon")
- **Official site:** https://marathonhn.com/ (source: web search "Techcombank Hanoi Marathon 2026 official site" → confirmed marathonhn.com as SEV's official site)
- **Other sellers:** njuko.com (source: web search — mentioned as registration platform alongside ActiUp); direction: official site → sellers (ActiUp page does not link back to marathonhn.com)
- **Sections:** Thông tin sự kiện | Chính sách Hủy - Chuyển nhượng - Thay đổi thông tin cá nhân/ cự ly | Size áo | Quy định tham dự
- **Prices:** IMAGE in "Chính sách Hủy...": https://pix.actiup.net/2026/01/15/1768464444593643/Marathon-2026-Chính-sách-thay-đổi-thông-tin.jpg — this is a **policy** image, not price tiers. No price table section found on ActiUp page. Size images (shirt size charts) in other sections. Prices likely on marathonhn.com (not fetched; page requires JS).
- **Other links:** none on ActiUp page
- **Notes:** No "Bảng giá vé" / "Chính sách giá vé" section on ActiUp — registration closed by sell-through or moved to official site only. SEV store (sevstore.vn) sells merchandise separately.

---

### KEYSHOP | KUN FUN RUN ĐỒNG THÁP 2026 (`kun-fun-run-dong-thap-2026-keyshop`)
- **ActiUp:** https://actiup.net/vi/event/kun-fun-run-dong-thap-2026-keyshop
- **Date:** 2026-10-09–10 (expo 09/10, race 10/10) | **Location:** Quảng trường Văn Miếu, Phường Cao Lãnh, Tỉnh Đồng Tháp
- **Distances:** Kids Fun Run only — target participants born 2016–2020 (source: web search, lofkun.vn)
- **Organizer:** Nexus Sport Events (same as VPBank Đất Sen Hồng, run together) | API merchant_public_name: `""` (empty)
- **Series:** none found — KUN Fun Run appears specific to VPBank Đất Sen Hồng Music Marathon context (looked: ActiUp list — no other KUN Fun Run slug)
- **Official site:** https://lofkun.vn/ — BIBs obtained by purchasing KUN products (≥ 400,000 VNĐ), not a standard ticket sale (source: web search)
- **Other sellers:** lofkun.vn (product purchase → BIB); registration via form link from lofkun.vn; ActiUp page appears to be informational
- **Sections:** Thông tin sự kiện | Size áo | Chính sách Hủy - Chuyển nhượng - Thay đổi thông tin cá nhân/ cự ly | Quy định tham dự
- **Prices:** not found — no "Chính sách giá vé" or "Bảng giá vé" section; BIBs tied to product purchase not a ticket price
- **Other links:** none found on ActiUp page
- **Notes:** Unusual model — this is a children's fun run (not a standalone paid event) co-located with the VPBank Đất Sen Hồng Marathon. BIBs are a promotion for KUN brand products. Not a normal sellable race.

---

### VPBank Đất Sen Hồng Music Marathon 2026 (`vpbank-dat-sen-hong-music-marathon-2026`)
- **ActiUp:** https://actiup.net/vi/event/vpbank-dat-sen-hong-music-marathon-2026
- **Date:** 2026-10-09–11 | **Location:** Đường Lý Thường Kiệt, Phường Cao Lãnh, Tỉnh Đồng Tháp (phía trước Công viên Văn Miếu)
- **Distances:** 5km, 10km, 21km, 42km (source: web search → datsenhongmarathon.com + pace8.vn)
- **Organizer:** Nexus Sport Events (primary) + VPBank (co-organizer/title sponsor) | API merchant_public_name: `"Đơn vị tổ chức: Nexus Sport Events – Đối tác chiến lược & Đơn vị đồng tổ chức: Ngân hàng TMCP Việt Nam Thịnh Vượng (VPBank)"`
- **Series:** VPBank Đất Sen Hồng Music Marathon — recurring; 2025 edition (`vpbank-dat-sen-hong-music-marathon-2025`, 2025-10-12) confirmed in ActiUp list
- **Official site:** https://datsenhongmarathon.com (source: web search → confirmed site found)
- **Other sellers:** iRace (source: web search); VPBank NEO app with exclusive member prices (source: web search). Direction: official site → sellers (ActiUp page has Google Drive link for rules, no other outbound links to sellers)
- **Sections:** Thông tin sự kiện | Bảng giá vé | Chính sách Hủy - Chuyển nhượng - Thay đổi thông tin cá nhân/ cự ly | Lịch trình sự kiện | Size áo | Sơ đồ đường chạy | Giải thưởng | Quy định tham dự
- **Prices:** IMAGE in "Bảng giá vé": https://pix.actiup.net/2026/07/10/1783621548081268/Price-list.jpg + https://pix.actiup.net/2026/07/10/1783621538350215/Group-discount.jpg — `image not read`; Transfer policies image: https://pix.actiup.net/2026/07/10/1783621583006172/Transfer-policies.jpg
- **Other links:** Google Drive (rules) https://drive.google.com/file/d/1v_ziPUQ4LqWNS8BWHtSGw9jGHt5qXoQs/view?usp=sharing (found on ActiUp page)
- **Notes:** Both the VPBank Đất Sen Hồng Marathon and KUN Fun Run (slug above) run on the same dates, same venue, same organizer (Nexus Sport Events).

---

### GLOBAL GATE HẠ LONG ESG++ MARATHON 2026 (`global-gate-halong-esg-marathon-2026`)
- **ActiUp:** https://actiup.net/vi/event/global-gate-halong-esg-marathon-2026
- **Date:** 2026-10-10–11 (expo 10/10, race 11/10) | **Location:** Vinhomes Global Gate Hạ Long, Quảng Ninh
- **Distances:** 42km, 21km, 10km, 3km (source: web search → 5bib.com + halongbaymarathon.com)
- **Organizer:** DHA Vietnam / Công ty TNHH Đức Hương Anh (source: web search — multiple news articles) | API merchant_public_name: `""` (empty); merchant_name (HTML): `"Công ty DHA Việt Nam"`
- **Series:** none found with this exact name; DHA Vietnam also organizes Standard Chartered Hanoi Marathon (different event). Global Gate branding appears new (looked: ActiUp list — no prior "Global Gate Halong" slug)
- **Official site:** https://halongbaymarathon.com/ (source: web search → confirmed)
- **Other sellers:** iRace: https://ticket.irace.vn/global-gate-ha-long-esg-marathon-2026; 5BIB: https://5bib.com/vi/events/global-gate-ha-long-2026; Pace8: https://pace8.vn/su-kien/global-gate-ha-long-esg-marathon-2026 (source: web search, Facebook post by organizer listing sellers)
- **Sections:** Thông tin sự kiện | Chính sách Hủy - Chuyển nhượng - Thay đổi thông tin cá nhân/ cự ly | Size áo | Quy định tham dự
- **Prices:** No "Chính sách giá vé" or "Bảng giá vé" section on ActiUp page. Size áo image: https://pix.actiup.net/2026/07/08/1783483358338129/bảng-size-áo-01.jpg. Prices presumably on halongbaymarathon.com or iRace (not fetched). From-price on API: 180,000 VNĐ.
- **Other links:** Google Drive (rules) https://drive.google.com/file/d/12KRxjkDPbyCZwQzsQKDyEaXQ7W7JC-AI/view (found on ActiUp page)
- **Notes:** DHA Vietnam is the same organizer as the Standard Chartered Hanoi Marathon (Heritage Race 2026) — different series, same company. ActiUp page has minimal content (no price section) — most content is on the official site.

---

### Gemadept Run Hải Phòng 2026 (`gemadept-run-hai-phong-city-2026`)
- **ActiUp:** https://actiup.net/vi/event/gemadept-run-hai-phong-city-2026
- **Date:** 2026-10-10 | **Location:** TP Hải Phòng, Việt Nam
- **Distances:** 5km, 10km (source: web search → gmdrun.gemadept.com.vn + gemadept.com.vn press release)
- **Organizer:** GEMADEPT (Gemadept Corporation) | API merchant_public_name: `""` (empty); merchant_name: `"GEMADEPT"`
- **Series:** Gemadept Run — season 5 (Mùa thứ 5); prior editions confirmed: Gemadept Run HCMC 2026 is a separate event in same series. Same series appears annually (source: web search → gmdrun.gemadept.com.vn)
- **Official site:** https://gmdrun.gemadept.com.vn/ (source: web search → gemadept.com.vn official press release)
- **Other sellers:** Pace8: https://pace8.vn/su-kien/gemadept-run-hai-phong-city-2026 (source: web search); direction: official site → sellers (ActiUp page links to Google Drive only)
- **Sections:** Thông Tin Chi Tiết | Chính sách giá vé | Size áo | Chính sách Hủy - Chuyển nhượng - Thay đổi thông tin cá nhân/ cự ly | Lịch trình sự kiện | Thông tin Race-kit | Quy định tham dự
- **Prices:** IMAGE in "Chính sách giá vé": https://pix.actiup.net/2026/09/08/1788841118953163/1.-BẢNG-GIÁ_GHP.jpg (main price table) + https://pix.actiup.net/2026/07/29/1785313346655620/2.-ĐẶC-QUYỀN.jpg (group perks) — `image not read`; Policy image: https://pix.actiup.net/2026/09/08/1788841217748450/5.-CHÍNH-SÁCH_GHP.jpg
- **Other links:** Google Drive (rules) https://drive.google.com/file/d/1NQHHmMrVXz4Dt2musrbYeEQg-M7dxUNF/view?usp=drive_link (found on ActiUp page)
- **Notes:** Gemadept runs two city events same season: Hải Phòng (5km/10km) and HCMC (5km/10km/21km). Both are corporate-sponsored runs for the logistics/shipping company Gemadept.

---

### LÀO CAI MARATHON 2026 - DÒNG CHẢY BIÊN CƯƠNG (`lao-cai-marathon-2026-dong-chay-bien-cuong`)
- **ActiUp:** https://actiup.net/vi/event/lao-cai-marathon-2026-dong-chay-bien-cuong
- **Date:** 2026-10-18 | **Location:** Quảng trường Tráng A Pao, Phường Lào Cai, Tỉnh Lào Cai (source: web search)
- **Distances:** 5.5km, 10.5km, 21km (source: web search — Viet Jungle organizer page); API extraction also shows 5km, 21km mentions in image alt text
- **Organizer:** Công ty TNHH Việt Jungle (VIET JUNGLE) | API merchant_public_name: `""` (empty); merchant_name: `"VIET JUNGLE"`
- **Series:** none found — first edition with this subtitle (looked: ActiUp list for "Lào Cai Marathon" — no prior editions found)
- **Official site:** not found (looked: ActiUp page outbound links — Google Drive rules link only; web search "Lào Cai Marathon 2026 official site" — only aggregator listings on iRace, 5BIB, ActiUp found)
- **Other sellers:** iRace: https://ticket.irace.vn/lao-cai-marathon-2026; 5BIB: https://5bib.com/vi/events/lao-cai-marathon-2026-dong-chay-bien-cuong (source: web search)
- **Sections:** Thông tin sự kiện | Chính sách giá vé | Chính sách Hủy - Chuyển nhượng - Thay đổi thông tin cá nhân/ cự ly | Lịch trình sự kiện | Size áo | Sơ đồ đường chạy | Giải thưởng | Quy định tham dự
- **Prices:** IMAGE in "Chính sách giá vé": https://pix.actiup.net/2026/06/09/1780995376079103/02-Bảng-giá-vé.png (main price table) + https://pix.actiup.net/2026/06/05/1780631595216266/Untitled-1-03.png + https://pix.actiup.net/2026/06/05/1780631648370910/Untitled-1-04.png + https://pix.actiup.net/2026/06/05/1780631684182365/Untitled-1-05.png + https://pix.actiup.net/2026/06/09/1780958256560586/Untitled-1-01.png — `image not read`
- **Other links:** Google Drive (rules) https://drive.google.com/file/d/1dT42OM0Jx4Qow1s14eaWdHkJNMWN2qil/view (found on ActiUp page)
- **Notes:** Road race (not trail) along the Red River border area. Distances are slightly non-standard (5.5km, 10.5km rather than 5km/10km). Viet Jungle also organizes the Vietnam Jungle Marathon (different event).

---

### VPBank Hanoi International Marathon 2026 (`vpbank-hanoi-international-marathon-2026`)
- **ActiUp:** https://actiup.net/vi/event/vpbank-hanoi-international-marathon-2026
- **Date:** 2026-10-18 | **Location:** Thành phố Hà Nội
- **Distances:** 42km, 21km, 10km, 5km (source: web search → vpbankmarathon.com + pace8.vn)
- **Organizer:** VPBank (Vietnam Prosperity Joint Stock Commercial Bank) as title sponsor/organizer | API merchant_public_name: `"Đơn vị tổ chức: Ngân hàng TMCP Việt Nam Thịnh Vượng (VPBank)"`; merchant_name: same
- **Series:** VPBank Hanoi International Marathon — recurring annual series (source: search → series has multiple editions; "VPBank Hanoi International Marathon" branded event distinct from other VPBank marathons)
- **Official site:** https://vpbankmarathon.com/ (found via outbound link on ActiUp page: `href="https://vpbankmarathon.com/quy-dinh"`)
- **Other sellers:** CTicket (cticket.vn) — primary; VPBank NEO app — exclusive VPBank member prices; ActiUp listed too (source: web search → confirmed via multiple sources)
- **Sections:** Thông tin sự kiện | LƯU Ý KHI MUA BIB | Quy định tham dự
- **Prices:** No price section on ActiUp page — minimal content (3 sections only). From-price on API: not available (API shows `min_price` field missing/0 for this event). Prices on vpbankmarathon.com (not fetched). Note: ActiUp page has note "LƯU Ý KHI MUA BIB" section which may explain redirect to official site.
- **Other links:** https://vpbankmarathon.com/quy-dinh (race rules, found on ActiUp page)
- **Notes:** ActiUp page is minimal — VPBank uses its own platform (vpbankmarathon.com + CTicket) as primary; ActiUp is secondary. Link direction: official site → ActiUp (not back). This is the Hanoi edition; VPBank Đất Sen Hồng is a different city race also by VPBank.

---

### GEMADEPT RUN HCMC 2026 (`gemadept-run-the-way-forward-2026`)
- **ActiUp:** https://actiup.net/vi/event/gemadept-run-the-way-forward-2026
- **Date:** 2026-10-24–25 (expo 24/10, race 25/10) | **Location:** Khu C13, Đường Tân Trào, Khu đô thị Phú Mỹ Hưng, Phường Tân Mỹ, TP. HCM
- **Distances:** 5km, 10km, 21km (source: web search → gmdrun.gemadept.com.vn)
- **Organizer:** GEMADEPT (Gemadept Corporation) | API merchant_public_name: `""` (empty); merchant_name: `"GEMADEPT"`
- **Series:** Gemadept Run Season 5 — same series as Gemadept Run Hải Phòng 2026 above; prior seasons confirmed (source: web search → gmdrun.gemadept.com.vn references "5 năm" / season 5)
- **Official site:** https://gmdrun.gemadept.com.vn/ (same as Hải Phòng edition)
- **Other sellers:** Pace8 (source: web search → pace8.vn listing found)
- **Sections:** Thông tin sự kiện | Chính sách giá vé | Chính sách hủy - Chuyển nhượng - Thay đổi thông tin cá nhân/ cự ly | Lịch trình sự kiện | Thông tin Race-kit | Quy định tham dự
- **Prices:** IMAGE in "Chính sách giá vé": https://pix.actiup.net/2026/09/08/1788840317592079/1.-BẢNG-GIÁ-VÉ_GHCM.jpg (main price table) + https://pix.actiup.net/2026/05/30/1780137159097994/2.-ĐẶC-QUYỀN-NHÓM.jpg (group perks) — `image not read`; Policy: https://pix.actiup.net/2026/09/08/1788840432667118/3.-CHÍNH-SÁCH_GHCM.jpg; Schedule: https://pix.actiup.net/2026/09/08/1788840370809318/4.-LỊCH-TRÌNH_GHCM.jpg
- **Other links:** Google Drive (rules) https://drive.google.com/file/d/1jfilJNoiY4O-6rrM8y8e4_xNnsr24eW6/view (found on ActiUp page)
- **Notes:** HCMC edition has 21km while Hải Phòng edition does not. Same official site covers both city editions.

---

### GIA LAI CITY TRAIL - GIẤC MƠ ĐẠI NGÀN 2026 (`gia-lai-city-trail-giac-mo-dai-ngan-2026`)
- **ActiUp:** https://actiup.net/vi/event/gia-lai-city-trail-giac-mo-dai-ngan-2026
- **Date:** 2026-10-30 – 2026-11-01 (main race day 01/11) | **Location:** Khu di tích Thắng cảnh Biển Hồ, TP. Pleiku, Gia Lai
- **Distances:** 6km, 12km, 30km, 50km, 70km (source: web search → gialaicitytrail.com + timve365.vn; names: "Mầm Xanh" 6km, "Băng Rừng" 12km, "Vượt Núi" 30km, "Lửa Thiêng" 50km, "Chiến binh Đại Ngàn" 70km)
- **Organizer:** VietRace365 (Công ty Cổ phần VietRace365) | API merchant_public_name: `""` (empty); merchant_name: `"VIETRACE365"`
- **Series:** Gia Lai City Trail — recurring (looked: ActiUp list for "Gia Lai" — `gia-lai-city-trail-giac-mo-dai-ngan-2026` is the only edition; prior editions not in ActiUp 301-event list)
- **Official site:** https://gialaicitytrail.com/ (source: web search → confirmed as official site)
- **Other sellers:** timve365.vn (primary, VietRace365's own platform): https://timve365.vn; iRace; EnjoySport (source: web search → gialaicitytrail.com + enjoysport.vn listing found; ActiUp page has no outbound links to sellers)
- **Sections:** Thông tin sự kiện | Bảng giá vé | Chính sách Hủy - Chuyển nhượng - Thay đổi thông tin cá nhân/ cự ly | Lịch trình sự kiện | Thông tin Race Kit | Giải thưởng | Sơ đồ đường chạy | Quy định tham dự
- **Prices:** IMAGE in "Bảng giá vé": https://pix.actiup.net/2026/05/16/1778908809002575/IMG_5763.jpeg (main price table) + https://pix.actiup.net/2026/03/20/1773992194770725/giá-nhóm.jpg (group price) — `image not read`; Schedule image: https://pix.actiup.net/2026/03/20/1773992313588680/lịch-trình-sự-kiện-(1).jpg
- **Other links:** none found on ActiUp page
- **Notes:** The organizer VietRace365 also operates timve365.vn (ticket platform); this is a case of organizer-owned seller. ActiUp page does not link to any seller — buyers must find the event via search. Distances (6km–70km) are trail distances.

---

### FV RUN - Run with Heart, Run for Hope (`fv-run`)
- **ActiUp:** https://actiup.net/vi/event/fv-run
- **Date:** 2026-10-31 – 2026-11-01 | **Location:** Khu P2 Park, Khu đô thị Phú Mỹ Hưng, Phường Tân Hưng, TP. HCM
- **Distances:** Family Run/Ekiden 3km relay (3×1km teams), 5km, 10km, 21km (source: web search → fvrun.com.vn + fvhospital.com)
- **Organizer:** FV Hospital (Bệnh viện FV) + Children of Vietnam Charitable Fund (Quỹ Nâng Bước Tuổi Thơ) as co-organizer | API merchant_public_name: `"Organizer: FV Hospital | Co-organizer: Children of Vietnam Charitable Fund"`
- **Series:** FV Run — recurring charity run; API slug is `fv-run` (no year) suggesting it's been recurring. Prior editions searched: not found in ActiUp 301-event list under "fv-run" variant slugs (looked: ActiUp list)
- **Official site:** https://fvrun.com.vn/ (source: web search → fvrun.com.vn confirmed)
- **Other sellers:** iRace; Pace8: https://pace8.vn (source: web search → pace8.vn listing confirmed)
- **Sections:** Thông tin sự kiện | Chính sách giá vé | Chính sách Hủy - Chuyển nhượng - Thay đổi thông tin cá nhân/ cự ly | Lịch trình sự kiện | Giải thưởng | Size áo | Quy định tham dự
- **Prices:** IMAGE in "Chính sách giá vé": https://pix.actiup.net/2026/07/28/1785236123797529/Ticket---Price-(3).jpg (main price table) + https://pix.actiup.net/2026/07/28/1785213132189176/Ticket---Incentive.jpg (incentives) — `image not read`
- **Other links:** none found on ActiUp page
- **Notes:** 100% of ticket revenue donated to Children of Vietnam for child surgery costs (source: fvhospital.com). The no-year slug `fv-run` suggests this event predates the slug naming convention with years. Family Run is an ekiden relay format (unusual).

---

### Giải Chạy Hồng – Pink Run 2026 (`giai-chay-hong-pink-run-2026`)
- **ActiUp:** https://actiup.net/vi/event/giai-chay-hong-pink-run-2026
- **Date:** 2026-11-01, 05:00–09:00 | **Location:** Celadon Sports & Resort Club, Số 2 đường D2, Phường Tân Sơn Nhì, Tân Phú, TP. HCM
- **Distances:** 3km, 10km (source: price image `price-pinkrun26.png`, read directly)
- **Organizer:** BCNV (Mạng Lưới Ung Thư Vú Việt Nam / Breast Cancer Network Vietnam) | API merchant_public_name: `"Mạng Lưới Ung Thu Vú Việt Nam - BCNV"`; merchant_name: same
- **Series:** Pink Run — recurring charity run for breast cancer awareness. Prior editions not found in ActiUp 301-event list under "pink-run" (looked: ActiUp list — only 2026 edition present)
- **Official site:** not found (looked: ActiUp page outbound links — only Google Docs; web search "Pink Run 2026 BCNV official site" — only ActiUp and news articles found)
- **Other sellers:** not found (looked: ActiUp page + web search — only ActiUp found)
- **Sections:** Thông tin sự kiện | Chính sách giá vé [2 images] | Chính sách Hủy - Chuyển nhượng - Thay đổi thông tin cá nhân/ cự ly | Thông tin Race-kit [img] | Sơ đồ đường chạy [img] | Giải thưởng [img] | Size áo [img] | Quy định tham dự
- **Prices:** IMAGE in "Chính sách giá vé": https://pix.actiup.net/2026/07/11/1783767689408581/price-pinkrun26.png — **READ** (source: image fetched and read directly):

  | Cự ly | Giá vé Tiêu chuẩn | Super Early Bird 08/7–18/7 | Early Bird 19/7–31/7 | Last call 01/8–20/9 | Late 21/9–05/10 |
  |-------|-------------------|--------------------------|----------------------|---------------------|-----------------|
  | 3 KM  | 569.000           | 459.000                  | 479.000              | 529.000             | 569.000         |
  | 10 KM | 799.000           | 629.000                  | 679.000              | 749.000             | 799.000         |

  All prices in VNĐ. Footer on image: "05:00 – 09:00, ngày 01.11.2026 | Celadon Sports & Resort Club, Số 2 đường D2, Phường Tân Sơn Nhì, Tân Phú, TP. HCM".
  Note: "1000 vé đầu tiên được tặng TÚI TOTE" (first 1000 tickets get a tote bag).

  Group prices: IMAGE https://pix.actiup.net/2026/07/11/1783767675896934/grouppolicy-pinkrun26.png — `image not read`

- **Other links:** Google Docs (race rules) https://docs.google.com/document/d/17ET73GwSgE0NX4rHLTHMiK4tfTzeYysU/edit (found on ActiUp page, in "Quy định tham dự" section)
- **Notes:** This is the calibration example from the plan. Prices confirmed exactly as specified. Location on image says "Celadon Sports & Resort Club" not just "Celadon City" — more specific. Sale ended 05/10 (already past on 2026-09-24 for Late tier). Organizer logo "BCNV" appears on price image top-left.

---

### Lamdong Trail 2026 (`lamdong-trail-2026`)
- **ActiUp:** https://actiup.net/vi/event/lamdong-trail-2026
- **Date:** 2026-11-06 – 2026-11-08 | **Location:** TTC World – Thung Lũng Tình Yêu, số 03-05-07 đường Mai Anh Đào, Phường Lâm Viên, Tp. Đà Lạt, Lâm Đồng
- **Distances:** 5km, 15km, 25km, 55km, 85km (source: ActiUp page — 5 separate route map images found in sections, each labeled by distance: `5km.jpg`, `15km.jpg`, `25km.jpg`, `55km.jpg`, `85km.jpg`)
- **Organizer:** GreenHat (merchant_name from HTML) | API merchant_public_name: `""` (empty); merchant_name: `"GreenHat"`
- **Series:** Lamdong Trail — recurring annual event; editions in ActiUp list: `lamdong-trail-2026` (2026); `lamdong-trail-2025` (2025-11-07) (confirmed in ActiUp 301-event JSON). Official site title says "Lamdong Trail 2025" on homepage (not updated) but organizes annually.
- **Official site:** https://lamdongtrail.vn/ (found via ActiUp page — Google Drive link in "Quy định tham dự"; lamdongtrail.vn confirmed separately via web search)
- **Other sellers:** ActiUp: https://actiup.net/vi/event/lamdong-trail-2026; iRace: https://ticket.irace.vn/lamdong-trail-2026; EnjoySport: https://enjoysport.vn/event/lam-dong-trail; 5BIB: https://5bib.com/vi/events/lamdong-trail-2026_208 (source: lamdongtrail.vn homepage — all four linked in nav dropdown "ĐĂNG KÝ"). **Direction: official site → sellers (lamdongtrail.vn links out to all four; ActiUp page does not link back to lamdongtrail.vn)**
- **Sections:** Thông tin sự kiện | Bảng giá vé | Chính sách Hủy - Chuyển nhượng - Thay đổi thông tin cá nhân/ cự ly | Lịch trình sự kiện | Thông tin Race-kit | Bản đồ đường chạy | Giải thưởng | Quy định tham dự
- **Prices:** IMAGE in "Bảng giá vé": https://pix.actiup.net/2026/09/23/1790156366572704/1st-pic-BẢNG-GIÁ-VÉ-update.png (main price table, updated 2026-09-23) + https://pix.actiup.net/2026/04/16/1776328845567974/Cs-vé-nhóm-(2).jpg (group policy) + https://pix.actiup.net/2026/04/16/1776328888803669/Cs-VĐV-(1).jpg (athlete policy) — `image not read`
- **Other links:** Google Drive (rules) https://drive.google.com/file/d/1cWGbhMwxlc-5lVVF5CtPGG9VXkUerNLW/view (found on ActiUp page)
- **Notes:** This is the explicitly documented example in design-v2.md. Confirmed: lamdongtrail.vn links to ActiUp, iRace, 5BIB, EnjoySport; ActiUp does NOT link back. Price image was updated on 2026-09-23 (yesterday) — very recent. Distances from map images (5km–85km) are trail distances. GreenHat is the organizer brand (not a known company name — possibly a trade name).

---

### Giải chạy bộ Salonpas 2026 (`salonpas-run-2026`)
- **ActiUp:** https://actiup.net/vi/event/salonpas-run-2026
- **Date:** 2026-11-07–08 | **Location:** Công viên Sáng Tạo, Phường An Khánh, TP. HCM
- **Distances:** 3km (Family), 5km, 10km, 21km (source: web search → salonpasrun.vn + pace8.vn)
- **Organizer:** CÔNG TY TNHH DƯỢC PHẨM HISAMITSU VIỆT NAM (Hisamitsu Vietnam Pharmaceutical) — maker of Salonpas patches | API merchant_public_name: `"CÔNG TY TNHH DƯỢC PHẨM HISAMITSU VIỆT NAM"`; merchant_name: same
- **Series:** Salonpas Run — recurring annual event (implied by official site salonpasrun.vn); prior editions not in ActiUp 301-event list (looked: ActiUp list)
- **Official site:** https://salonpasrun.vn/ (found via outbound link on ActiUp page: `href="https://salonpasrun.vn/thong-tin-giai/#quy-tac-dieu-le"` in "Quy định tham dự")
- **Other sellers:** iRace; Pace8: https://pace8.vn (source: web search); direction: official site → sellers (salonpasrun.vn links to sellers; ActiUp page links to salonpasrun.vn)
- **Sections:** Thông tin sự kiện | Chính sách giá vé | Chính sách Hủy - Chuyển nhượng - Thay đổi thông tin cá nhân/ cự ly | Lịch trình sự kiện | Size áo | Sơ đồ đường chạy | Giải thưởng | Quy định tham dự
- **Prices:** IMAGE in "Chính sách giá vé": https://pix.actiup.net/2026/06/15/1781512677943304/Bảng-giá-vé-(1).jpg (main price table) + https://pix.actiup.net/2026/06/15/1781512792880030/uu-dai-nhom-(1).jpg (group discount) — `image not read`; Policy: https://pix.actiup.net/2026/06/15/1781512826606641/chinh-sach-01.jpg; Route maps for each distance: 3km, 5km, 10km, 21km as separate images
- **Other links:** https://salonpasrun.vn/thong-tin-giai/#quy-tac-dieu-le (race rules, found on ActiUp page)
- **Notes:** Salonpas Run is a pharma-sponsored (Hisamitsu) corporate run. ActiUp → official site link direction confirmed (ActiUp page links to salonpasrun.vn). Separate distance route map images for each of 4 distances is unusual pattern.

---

### Standard Chartered Marathon Di sản Hà Nội 2026 (`standard-chartered-hanoi-marathon-heritage-race-2026`)
- **ActiUp:** https://actiup.net/vi/event/standard-chartered-hanoi-marathon-heritage-race-2026
- **Date:** 2026-11-06–08 (expo 06–07/11, race 08/11) | **Location:** Công viên Thống Nhất, Hà Nội (source: web search → hanoi-marathon.com)
- **Distances:** 42km, 21km, 10km, 5km, Kid Dash 2.1km (source: web search → hanoi-marathon.com)
- **Organizer:** DHA Vietnam / Công ty TNHH Đức Hương Anh | API merchant_public_name: `""` (empty); merchant_name: `"Công ty DHA Việt Nam"`
- **Series:** Standard Chartered Hanoi Marathon / Vietnam Heritage Marathon — recurring annual series; prior editions confirmed (search → hanoi-marathon.com shows history; "Heritage Race" subtitle varies by year)
- **Official site:** https://hanoi-marathon.com/ (source: web search → multiple sources confirm hanoi-marathon.com; also payment portal: payment.vietnamheritagemarathon.com)
- **Other sellers:** Official registration via hanoi-marathon.com + payment.vietnamheritagemarathon.com; iRace (mentioned in search); direction: official site → sellers (ActiUp page does not link to official site)
- **Sections:** Thông tin sự kiện | Bảng giá vé | Chính sách Hủy - Chuyển nhượng - Thay đổi thông tin cá nhân/ cự ly | Thông tin Race-kit | Quy định tham dự
- **Prices:** IMAGE in "Bảng giá vé": https://pix.actiup.net/2026/03/03/1772507394252745/FlashSalePrice-SCHM26.jpg (flash sale price table) — `image not read`; Size chart: https://pix.actiup.net/2026/03/02/1772441058357097/sizechart-SCHM26.jpg. Note: "Flash Sale" in filename suggests this was an early promotion image.
- **Other links:** Google Drive (rules) https://drive.google.com/file/d/1dWhJOepPOz7srAJf7NGjD27KhBn6YTNo/view?usp=drive_link (found on ActiUp page)
- **Notes:** DHA Vietnam is same organizer as Global Gate Halong ESG++ Marathon (different series). The price image is labeled "FlashSalePrice" — it may show early-bird/flash-sale tiers only, not the full pricing ladder. Late phase (Sep 1–30 2026) confirmed from hanoi-marathon.com — so this image is outdated vs. current pricing. ActiUp page appears to be a legacy page not updated with latest tiers.

---

### GIẢI BÁN MARATHON QUỐC TẾ VIỆT NAM 2024 TÀI TRỢ BỞI HERBALIFE (`giai-ban-marathon-quoc-te-viet-nam-2024`)
- **ActiUp:** https://actiup.net/vi/event/giai-ban-marathon-quoc-te-viet-nam-2024
- **Date:** 2024-01-01, 04:00 | **Location:** Hà Nội, Việt Nam
- **Distances:** 5km, 10km, 21km (half marathon) — inferred from race name "Bán Marathon" (half marathon) and typical Vietnam Athletics Federation event format
- **Organizer:** Liên Đoàn Điền Kinh Việt Nam (Vietnam Athletics Federation) | API merchant_public_name: `"Liên Đoàn Điền Kinh Việt Nam"`; merchant_name: same
- **Series:** Vietnam International Half Marathon powered by Herbalife — recurring; 2025 (`vietnam-international-half-marathon-2025`, 2026-01-01) + 2026 (`vietnam-international-half-marathon-2026`, 2026-01-01) editions confirmed in ActiUp list. Note: all three editions have `start_date: 2026-01-01` in the API — the 2024 and 2025 editions appear to have incorrect dates in ActiUp (likely placeholder date issue)
- **Official site:** not found (looked: ActiUp page outbound links — none; web search "Vietnam International Half Marathon 2024 Herbalife" — no dedicated site found, only press releases and aggregator pages)
- **Other sellers:** not found (looked: ActiUp page + web search)
- **Sections:** Thông tin sự kiện | Bảng giá vé | Lịch trình sự kiện | Race-kit | Bản đồ đường chạy | Giải thưởng | Quy định tham dự | Quy định nội dung đồng đội | Ban tổ chức
- **Prices:** IMAGE in "Bảng giá vé": https://pix.raceez.com/2023/10/31/content_actiup_1description_vi + https://pix.raceez.com/2023/10/31/content_actiup_1description_vi_20231031103039. — URLs from old `pix.raceez.com` domain (not pix.actiup.net), appear to be legacy image hosting; `image not read` (URL pattern suggests images may not resolve correctly)
- **Other links:** none
- **Notes:** Old image hosting on `pix.raceez.com` (ActiUp's previous domain name was raceez). All three editions (2024/2025/2026) show `start_date: 2026-01-01` in the API — data quality issue. The "Ban tổ chức" section lists the Vietnam Athletics Federation. Team event included ("đồng đội" rules section).

---

### Minh Đạm Discovery Marathon 2024 (`minh-dam-discovery-marathon-2024`)
- **ActiUp:** https://actiup.net/vi/event/minh-dam-discovery-marathon-2024
- **Date:** 2024-02-25, 03:00 | **Location:** Long Hải – BRVT (Bà Rịa – Vũng Tàu)
- **Distances:** not found (looked: ActiUp page sections text — no distance km values in text; image in "Giá vé" section uses old pix.raceez.com URLs; web search not performed for this race specifically)
- **Organizer:** Công ty Cổ phần Secret Sport Events | API merchant_public_name: `""` (empty); merchant_name: `"CÔNG TY CỔ PHẦN SECRET SPORT EVENTS"`
- **Series:** Minh Đạm Discovery Marathon — recurring; prior editions not found in ActiUp 301-event list (only 2024 edition present; looked: ActiUp list for "minh-dam")
- **Official site:** not found (looked: ActiUp page outbound links — none; web search not performed)
- **Other sellers:** not found (looked: ActiUp page)
- **Sections:** Thông tin sự kiện | Giá vé | Bộ Racekit | Lịch trình sự kiện | Quy định tham dự | Ban tổ chức
- **Prices:** IMAGE in "Giá vé": https://pix.raceez.com/2023/07/05/content_actiup_1description_vi_20230705110324. + https://pix.raceez.com/2023/07/05/content_actiup_1description_vi_20230705110402. + https://pix.raceez.com/2023/07/06/content_actiup_1description_vi — `image not read` (pix.raceez.com legacy URLs)
- **Other links:** none
- **Notes:** Legacy pix.raceez.com image hosting. "Ban tổ chức" section present (unusual for newer events). Long Hải, BRVT is a coastal town in Bà Rịa – Vũng Tàu province — route likely along the coast. Secret Sport Events is a known sports event company.

---

### Dalat Ultra Trail 2024 (`dalat-ultra-trail-2024`)
- **ActiUp:** https://actiup.net/vi/event/dalat-ultra-trail-2024
- **Date:** 2024-03-15, 08:00 | **Location:** Thung Lũng Tình Yêu, Thành phố Đà Lạt
- **Distances:** not found (looked: ActiUp page text — no km values extracted; image in "Giá vé" section uses legacy pix.raceez.com URLs)
- **Organizer:** Vietnam MTB Series | API merchant_public_name: `""` (empty); merchant_name: `"Vietnam MTB Series"`
- **Series:** Dalat Ultra Trail — recurring; 2025 (`dalat-ultra-trail-2025`, 2025-03-28) + 2026 (`dalat-ultra-trail-2026`, 2026-03-27) editions confirmed in ActiUp list. Same venue (Valley of Love / Thung Lũng Tình Yêu, Đà Lạt) as Lamdong Trail 2026. Also listed on vietnammtbseries.com (mentioned in design-v2 seed sites)
- **Official site:** not found directly (looked: ActiUp page outbound links — none; vietnammtbseries.com listed in design-v2 as a hub for this organizer)
- **Other sellers:** not found (looked: ActiUp page)
- **Sections:** Thông tin sự kiện | Giá vé | Chính sách Hủy - Chuyển nhượng - Thay đổi thông tin cá nhân/ cự ly | Lịch trình sự kiện | Race-kit | Bản đồ đường chạy | Giải thưởng | Thông tin chung | Quy định tham dự | Ban tổ chức
- **Prices:** IMAGE in "Giá vé": https://pix.raceez.com/2023/10/13/content_actiup_1description_vi_20231013171043. + https://pix.raceez.com/2023/10/16/content_actiup_1description_vi — `image not read` (pix.raceez.com legacy URLs)
- **Other links:** none
- **Notes:** Vietnam MTB Series is a known mountain biking + trail running event brand also responsible for vietnammtbseries.com. Same Valley of Love venue as Lamdong Trail (GreenHat organizer) — different organizer, same location. "Thông tin chung" section is unusual (general info section). 10 sections including "Ban tổ chức" (organizer info).

---

### CHẠY VÌ TRÁI TIM 2024 (`chay-vi-trai-tim-2024`)
- **ActiUp:** https://actiup.net/vi/event/chay-vi-trai-tim-2024
- **Date:** 2024-03-23, 06:00 | **Location:** Công viên Yên Sở, Hoàng Mai, Hà Nội
- **Distances:** not found (looked: ActiUp page text — no km values extracted; image in "Giá vé" uses legacy pix.raceez.com URL)
- **Organizer:** Gamuda Land (Gamuda Land Vietnam) | API merchant_public_name: `""` (empty); merchant_name: `"Gamuda Land"`
- **Series:** Run for the Heart / Chạy Vì Trái Tim — recurring; `run-for-the-heart-2026` (2026-12-06) confirmed in ActiUp list. 2024 slug uses Vietnamese name, 2026 uses English — different slugs, same event (source: ActiUp JSON name matching with "Chạy Vì Trái Tim" / "Run for the Heart")
- **Official site:** not found (looked: ActiUp page outbound links — none; web search not performed)
- **Other sellers:** not found (looked: ActiUp page)
- **Sections:** Thông tin sự kiện | Giá vé | Lịch trình sự kiện | Bộ Racekit | Size áo | Bản đồ sự kiện | Quy định tham dự
- **Prices:** IMAGE in "Giá vé": https://pix.raceez.com/2024/02/29/content_actiup_1description_vi — `image not read` (pix.raceez.com legacy URL; URL also has no file extension, may not resolve)
- **Other links:** none
- **Notes:** Gamuda Land is a Malaysian property developer with a large development at Yên Sở, Hanoi (Gamuda City). This run is a community event tied to their real estate development. Công viên Yên Sở (Yên Sở Park) is adjacent to Gamuda City. 2026 edition renamed in English ("Run for the Heart") — different ActiUp slug.

---

### AQUA WARRIORS HALONG BAY 2024 (`aqua-warriors-halong-bay-2024`)
- **ActiUp:** https://actiup.net/vi/event/aqua-warriors-halong-bay-2024
- **Date:** 2024-04-14, 04:00 | **Location:** Thành phố Hạ Long
- **Distances:** not found (looked: ActiUp page text — no km values; "Giá vé" section has `$17` reference ID — description not resolved in HTML)
- **Organizer:** BOLT EVENT | API merchant_public_name: `""` (empty); merchant_name: `"BOLT EVENT"`
- **Series:** Aqua Warriors Halong Bay — recurring; 2025 (`aqua-warriors-halong-bay-2025`, 2025-04-12) + 2026 (`aqua-warriors-halong-bay-2026`, 2026-04-11) confirmed in ActiUp list. Also: `aqua-warriors-van-don` series (different location, same organizer)
- **Official site:** not found (looked: ActiUp page outbound links — Google Drive link only; web search not performed for this race)
- **Other sellers:** not found (looked: ActiUp page)
- **Sections:** Thông tin sự kiện | Giá vé | Lịch trình sự kiện | Bộ Racekit | Size áo | Bản đồ sự kiện | Quy định tham dự | Ban tổ chức
- **Prices:** Giá vé section has `$17` reference — description text is `$17` placeholder (RSC chunk reference not resolved in static HTML). Price content not accessible from HTML alone. `image not read`
- **Other links:** Google Drive (rules) https://drive.google.com/file/d/1ZphD8n9r4AY5BNSGnt25VzZ9ieoTsNN2/view?usp=sharing (found on ActiUp page)
- **Notes:** BOLT EVENT also organizes `aqua-warriors-van-don` series (Van Don, Quảng Ninh) — same brand, different location. "Aqua Warriors" suggests swim+run (aquathlon) format, not pure running. Unresolved `$17` RSC reference means the price content was rendered client-side only.

---

## 3. Summary tables

### Organizers

| Organizer | Races in the 20 (slugs) | Official site |
|-----------|------------------------|---------------|
| BCNV (Mạng Lưới Ung Thư Vú Việt Nam) | `giai-chay-hong-pink-run-2026` | not found |
| Nexus Sport Events | `test-run-2026-speed-your-pr`, `kun-fun-run-dong-thap-2026-keyshop`, `vpbank-dat-sen-hong-music-marathon-2026` | datsenhongmarathon.com (for VPBank DSH) |
| DHA Vietnam (Công ty TNHH Đức Hương Anh) | `global-gate-halong-esg-marathon-2026`, `standard-chartered-hanoi-marathon-heritage-race-2026` | halongbaymarathon.com; hanoi-marathon.com |
| GEMADEPT | `gemadept-run-hai-phong-city-2026`, `gemadept-run-the-way-forward-2026` | gmdrun.gemadept.com.vn |
| Sunrise Events Vietnam (SEV) | `the-5th-edition-of-the-techcombank-hanoi-international-marathon` | marathonhn.com |
| VPBank | `vpbank-hanoi-international-marathon-2026` | vpbankmarathon.com |
| VIET JUNGLE | `lao-cai-marathon-2026-dong-chay-bien-cuong` | not found |
| VIETRACE365 | `gia-lai-city-trail-giac-mo-dai-ngan-2026` | gialaicitytrail.com |
| FV Hospital + Children of Vietnam | `fv-run` | fvrun.com.vn |
| GreenHat | `lamdong-trail-2026` | lamdongtrail.vn |
| Hisamitsu Vietnam | `salonpas-run-2026` | salonpasrun.vn |
| Vietnam Athletics Federation | `giai-ban-marathon-quoc-te-viet-nam-2024` | not found |
| Secret Sport Events | `minh-dam-discovery-marathon-2024` | not found |
| Vietnam MTB Series | `dalat-ultra-trail-2024` | vietnammtbseries.com (design-v2 seed site) |
| Gamuda Land | `chay-vi-trai-tim-2024` | not found |
| BOLT EVENT | `aqua-warriors-halong-bay-2024` | not found |

### Series

| Series | Organizer | Editions found in ActiUp list |
|--------|-----------|-------------------------------|
| VPBank Đất Sen Hồng Music Marathon | Nexus Sport Events | 2025 (Oct), 2026 (Oct) |
| Gemadept Run | GEMADEPT | Season 5 = 2026 Hải Phòng + HCMC; prior seasons implied |
| Techcombank Hanoi Marathon | Sunrise Events Vietnam | Season 5 = 2026; prior seasons not in ActiUp list |
| VPBank Hanoi International Marathon | VPBank | 2026; prior editions not in ActiUp list |
| Lamdong Trail | GreenHat | 2025 (Nov), 2026 (Nov) |
| Standard Chartered / Heritage Marathon Hanoi | DHA Vietnam | Annual; prior editions not in ActiUp list |
| Salonpas Run | Hisamitsu Vietnam | Annual; prior editions not in ActiUp list |
| Pink Run | BCNV | Annual; prior editions not in ActiUp list |
| FV Run | FV Hospital | Annual; prior editions not in ActiUp list |
| Vietnam International Half Marathon (Herbalife) | Vietnam Athletics Federation | 2024, 2025, 2026 (all show date 2026-01-01 in API — data issue) |
| Dalat Ultra Trail | Vietnam MTB Series | 2024 (Mar), 2025 (Mar), 2026 (Mar) |
| Aqua Warriors Halong Bay | BOLT EVENT | 2024 (Apr), 2025 (Apr), 2026 (Apr) |
| Chạy Vì Trái Tim / Run for the Heart | Gamuda Land | 2024 (Mar), 2026 (Dec) |
| Gia Lai City Trail | VIETRACE365 | 2026 only in ActiUp list |

### Sellers / domains

| Domain | What it is | Races in the 20 | Example URL |
|--------|-----------|-----------------|-------------|
| actiup.net | Ticket aggregator (primary discovery source) | 20/20 | https://actiup.net/vi/event/lamdong-trail-2026 |
| ticket.irace.vn | Ticket aggregator | ≥5 (lamdong-trail, lao-cai, global-gate, fv-run, standard-chartered — from web search) | https://ticket.irace.vn/lamdong-trail-2026 |
| 5bib.com | Ticket aggregator | ≥3 (lamdong-trail, global-gate, lao-cai) | https://5bib.com/vi/events/lamdong-trail-2026_208 |
| enjoysport.vn | Ticket aggregator | ≥1 (lamdong-trail) | https://enjoysport.vn/event/lam-dong-trail |
| pace8.vn | Ticket aggregator | ≥4 (gemadept HP + HCMC, salonpas, fv-run) | https://pace8.vn/su-kien/gemadept-run-hai-phong-city-2026 |
| cticket.vn | Ticket platform | ≥1 (vpbank-hanoi) | https://cticket.vn |
| njuko.com | Registration platform | ≥1 (techcombank) | (URL not found in research) |
| timve365.vn | Ticket platform (VietRace365 owned) | ≥1 (gia-lai) | https://timve365.vn |
| datsenhongmarathon.com | Official race site | 1 (vpbank-dat-sen-hong) | https://datsenhongmarathon.com |
| halongbaymarathon.com | Official race site | 1 (global-gate-halong) | https://halongbaymarathon.com |
| hanoi-marathon.com | Official race site | 1 (standard-chartered) | https://hanoi-marathon.com |
| marathonhn.com | Official race site | 1 (techcombank) | https://marathonhn.com |
| vpbankmarathon.com | Official race site | 1 (vpbank-hanoi) | https://vpbankmarathon.com |
| gmdrun.gemadept.com.vn | Official race site | 2 (gemadept HP + HCMC) | https://gmdrun.gemadept.com.vn |
| lamdongtrail.vn | Official race site | 1 (lamdong-trail) | https://lamdongtrail.vn |
| gialaicitytrail.com | Official race site | 1 (gia-lai) | https://gialaicitytrail.com |
| salonpasrun.vn | Official race site | 1 (salonpas) | https://salonpasrun.vn |
| fvrun.com.vn | Official race site | 1 (fv-run) | https://fvrun.com.vn |

### Where prices are (on ActiUp pages)

| Format | Count | Section title(s) |
|--------|-------|-----------------|
| IMAGE only | 13/20 | "Chính sách giá vé", "Bảng giá vé", "Giá vé" |
| No price section on ActiUp page | 4/20 | (techcombank, vpbank-hanoi, global-gate-halong, kun-fun-run) |
| Legacy pix.raceez.com images (unresolved) | 4/20 | "Giá vé" (past events: 2024 editions) |
| Text prices | 0/20 | — |
| Login wall | 0/20 | — |
| From-price only | 0/20 | — |

**Price section title variants seen:** "Chính sách giá vé" (7), "Bảng giá vé" (4), "Giá vé" (5 — all past events), no section (4)

**Price images that were actually READ:** 1 (Pink Run `price-pinkrun26.png` — full tier table transcribed)

### Official sites seen

| URL | Layout notes | Links to sellers |
|-----|-------------|-----------------|
| lamdongtrail.vn | WordPress; nav dropdown with 4 seller links | ActiUp, iRace, EnjoySport, 5BIB |
| halongbaymarathon.com | Not fetched directly | iRace, ActiUp, 5BIB, Pace8 (from web search) |
| hanoi-marathon.com | Not fetched directly | payment.vietnamheritagemarathon.com (own portal), iRace |
| marathonhn.com | Not fetched directly | njuko.com, ActiUp |
| vpbankmarathon.com | Not fetched directly | CTicket, ActiUp, VPBank NEO app |
| gmdrun.gemadept.com.vn | Not fetched directly | ActiUp, Pace8 |
| datsenhongmarathon.com | Not fetched directly | ActiUp, iRace |
| gialaicitytrail.com | Not fetched directly | timve365.vn, iRace, EnjoySport |
| salonpasrun.vn | Not fetched directly; race-specific | ActiUp, iRace, Pace8 |
| fvrun.com.vn | Not fetched directly | ActiUp, iRace, Pace8 |

---

## 4. Surprises and open questions

### Surprises

1. **DHA Vietnam organizes two separate big marathons** (Global Gate Halong ESG++ and Standard Chartered Hanoi Heritage Race) with different official sites (`halongbaymarathon.com` vs `hanoi-marathon.com`). Not obvious from ActiUp data alone.

2. **Nexus Sport Events organizes 3 of the 15 upcoming races** including two that run concurrently (VPBank Đất Sen Hồng + KUN Fun Run on same dates, same venue). They are prolific.

3. **ActiUp does not show price sections for 4 upcoming races** — including the large VPBank Hanoi Marathon and Techcombank Marathon. These events use their own official sites as primary registration channels and only list on ActiUp as secondary exposure. The "Chỉ từ" (from) price in the API is the only pricing hint.

4. **KUN Fun Run is not a standard race** — it's a children's fun run where BIBs are earned by purchasing KUN-brand products (≥400,000 VNĐ). It appears in the ActiUp sports listing but has no ticket price. This would not fit cleanly into the `prices` schema.

5. **The same venue (Thung Lũng Tình Yêu / Valley of Love, Đà Lạt)** hosts both Lamdong Trail (GreenHat) and Dalat Ultra Trail (Vietnam MTB Series) — different organizers, same location, different seasons.

6. **pix.raceez.com legacy images**: All 4 past-edition races (2024) use image URLs on `pix.raceez.com` instead of `pix.actiup.net`. The old domain appears to be ActiUp's predecessor. These image URLs may or may not still resolve — the images were not read.

7. **actaiUp → official site link direction is one-way for most races**: Only Salonpas Run has an outbound link to its official site from the ActiUp page. Official sites consistently link out to sellers, but sellers rarely link back. This is exactly as noted in design-v2.md.

8. **VPBank runs two different marathon brands**: VPBank Đất Sen Hồng Music Marathon (Nexus Sport Events, Đồng Tháp, Oct) AND VPBank Hanoi International Marathon (VPBank direct, Hanoi, Oct). Same month, different cities, different organizer arrangements.

9. **Aqua Warriors "Giá vé" section has unresolved `$17` RSC reference**: The price content was rendered client-side only and not in the static HTML. This means the fingerprint-based approach in design-v2 might not catch price changes for events with this rendering pattern.

10. **Vietnam International Half Marathon 2024/2025/2026 all show `start_date: 2026-01-01`** in the API — a data quality bug in ActiUp for this recurring event.

### Open questions / items for design-v2 recipes

1. **What does the `$17` RSC reference mean?** Some events render their description content via a second HTTP request (RSC stream). The plain curl approach gets the static HTML only. A recipe for these events needs to also fetch the RSC payload stream (different URL pattern). Needs investigation.

2. **Should "KUN Fun Run" (product-purchase BIB) be included in the data model?** It has no `price` — the BIB is an entitlement from a product purchase. The `registrations` schema doesn't cover this.

3. **Salonpas Run and lamdongtrail.vn both link from ActiUp → official site**: This is the reverse of what design-v2 assumes. The plan said "official site → sellers" is the dominant direction. Salonpas confirms the link appears on the ActiUp page (in "Quy định tham dự" section pointing to salonpasrun.vn). The official site recipe should also check if there's a link from ActiUp page to the official site.

4. **lamdongtrail.vn prices**: The official site (WordPress) likely has prices as text (WooCommerce shop) as noted in design-v2. This was not verified (page not fetched). Needs a recipe test.

5. **Standard Chartered price image is labeled "FlashSalePrice"** — it may be outdated by late September 2026 (Late phase is Sep 1–30). The recipe needs to detect which price image is current vs. superseded.

6. **GEMADEPT uses the same image naming convention across two city editions** (e.g., `1.-BẢNG-GIÁ_GHP.jpg` for Hải Phòng, `1.-BẢNG-GIÁ-VÉ_GHCM.jpg` for HCMC) — the prefix number + category naming is consistent. This may generalize to a recipe pattern for corporate-run events.
