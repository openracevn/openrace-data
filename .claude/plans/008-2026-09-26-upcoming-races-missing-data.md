# Upcoming races missing price / distances / location

## Roadmap fit

Serves path step 1 (trusted data) and trust principle 1 (every fact traces to a source): 21 of 47 upcoming races (date ≥ 2026-09-26) are missing `prices`, `courses` (distances) and/or `location.venue`. No tension with a constraint or non-goal — this is data fill via existing sources/recipes, not scope expansion. Work to be split across parallel opencode workers, supervised.

## How this list was built

For each race JSON in `data/races/`, filtered to `date >= "2026-09-26"`, flagged as missing:
- `price` if `prices` is empty
- `distances` if `courses` is empty
- `location` if `location.venue` is null

Latest race date in the dataset overall: `2027-05-08` (`sunrise-sprint-viet-nam-in-da-nang-2027`).
47 races upcoming; 21 have at least one gap.

## The list (21 races)

| Date | Slug | Missing | Name |
| --- | --- | --- | --- |
| 2026-09-27 | vnexpress-marathon-nghe-an | price, distances, location | VnExpress Marathon Grand Tour Nghe An 2026 |
| 2026-10-04 | the-5th-edition-of-the-techcombank-hanoi-international-marathon | price | Giải Marathon Quốc tế Hà Nội Techcombank Mùa thứ 5 |
| 2026-10-09 | kun-fun-run-dong-thap-2026-keyshop | price, distances | KEYSHOP \| KUN FUN RUN ĐỒNG THÁP 2026 |
| 2026-10-09 | mini-game-kun-fun-run-dong-thap-2026 | price, distances | MINIGAME \| KUN FUN RUN ĐỒNG THÁP 2026 |
| 2026-10-10 | global-gate-halong-esg-marathon-2026 | price | GLOBAL GATE HẠ LONG ESG++ MARATHON 2026 |
| 2026-10-18 | vpbank-hanoi-international-marathon-2026 | price | VPBank Hanoi International Marathon 2026 |
| 2026-11-07 | standard-chartered-hanoi-marathon-heritage-race-2026 | price, distances | Standard Chartered Marathon Di sản Hà Nội 2026 |
| 2026-11-14 | 2026-ironkids-viet-nam-in-phu-quoc | price | 2026 IRONKIDS Viet Nam in Phu Quoc |
| 2026-11-14 | 2026-sunrise-sprint-viet-nam-in-phu-quoc | price | 2026 SUNRISE SPRINT Viet Nam in Phu Quoc |
| 2026-11-27 | ultra-trail-cao-bang-2026 | price | ULTRA TRAIL CAO BANG 2026 |
| 2026-11-29 | vnexpress-marathon-ha-noi | location | VnExpress Marathon Hanoi Midnight 2026 |
| 2026-12-05 | nghe-an-legacy-marathon-ve-mien-non-xanh-nuoc-biec | price | NGHỆ AN LEGACY MARATHON - VỀ MIỀN NON XANH NƯỚC BIẾC |
| 2026-12-06 | empower-run-2026 | price | Hành Trình Tiếp Sức 2026 |
| 2026-12-06 | the-9th-edition-of-the-techcombank-ho-chi-minh-city-internationalmarathon | price | Giải Marathon Quốc tế Thành phố Hồ Chí Minh Techcombank Mùa thứ 9 |
| 2026-12-20 | giai-marathon-quoc-te-di-san-can-tho-quan-quan-21 | price | Giải Marathon Quốc tế Di sản Cần Thơ 2026 |
| 2026-12-25 | cuc-phuong-jungle-paths-2026 | price | CUC PHUONG JUNGLE PATHS 2026 |
| 2026-12-27 | vnexpress-marathon-hai-phong | location | VnExpress Marathon Hai Phong 2026 |
| 2027-01-24 | tet-run-mien-nam-2027 | distances | TẾT RUN MIỀN NAM 2027 |
| 2027-04-11 | giai-chay-run-to-live-2027-chay-vi-cuoc-song-tot-dep-hon | price | Giải chạy Run To Live 2027 – Chạy vì cuộc sống tốt đẹp hơn |
| 2027-05-08 | 2027-ironkids-viet-nam-in-da-nang | price | 2027 IRONKIDS Viet Nam in Da Nang |
| 2027-05-08 | 2027-sunrise-sprint-viet-nam-in-da-nang | price | 2027 SUNRISE SPRINT Viet Nam in Da Nang |

## Next step (not started)

Split this list across parallel opencode workers (see `scripts/lib/recipes/README.md` for how a site is read, and `.claude/skills/check-race` for single-race workflow). Each worker re-checks a race's existing `sources[]` for the missing fields, or reads the registration site with agent-read/Firecrawl per the recipe for that site, then edits the race JSON with proper `sources[].extracted` provenance — no inventing values. Supervise output before commit per AGENTS.md ("Automated, not reviewed" principle means validation/sanity checks happen before commit, not that output goes in unchecked).
