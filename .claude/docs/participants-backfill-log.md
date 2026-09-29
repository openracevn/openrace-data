# Participants backfill log

Which races the fast lane (`backfill-field` skill, plan 017) has already been run over, and why the misses have no count. Read this before a new batch so nothing is searched twice. Add a batch below each time one is run.

Method for all batches: one `WebSearch` per race, a second wording for misses, `scripts/backfill-verify.ts` dry then `--apply`. Counts stored from a result title are `medium`. "Hơn"/"gần" counts are lower bounds or approximations.

## Batches 1–5 (2026-09-29)

### Stored

| Race (slug) | Count | Source |
| --- | --- | --- |
| hcmc-marathon-2018 | 8,500 | vietnamnet.vn |
| hcmc-marathon-2019 | 9,000 (hơn) | congthuong.vn |
| hcmc-marathon-2020 | 9,000 (hơn) | plo.vn |
| salonpas-hcmc-marathon-2021 | 10,000 (hơn) | znews.vn |
| salonpas-hcmc-marathon-2022 | 7,500 (hơn) | voh.com.vn |
| salonpas-hcmc-marathon-2023 | 10,000 (hơn) | vietnamplus.vn |
| hcmc-marathon-2024 | 11,000 | nld.com.vn |
| hcmc-marathon-2025 | 10,000 (hơn) | hcmcpv.org.vn |
| hcmc-marathon-2026 | 11,000 | tuoitre.vn |
| halong-bay-heritage-marathon-2018 | 9,000 (hơn) | vov.gov.vn |
| techcombank-ho-chi-minh-city-international-marathon-2025 | 23,000 (hơn) | dientuungdung.vn |
| vnexpress-marathon-quy-nhon-4 (2022) | 10,000 (gần) | nhandan.vn |
| vnexpress-marathon-quy-nhon-6 (2024) | 8,000 | thanhnien.vn |
| vnexpress-marathon-quy-nhon-7 (2025) | 12,000 (hơn) | plo.vn |
| vnexpress-marathon-quy-nhon (2026) | 8,000 | baogialai.com.vn |

### Searched, not stored (and why)

| Race (slug) | Why no count | Next thing to try |
| --- | --- | --- |
| hcmc-run-2015 | No count in any result. Only "hơn 6.400" seen in a Kenh14 pre-race article, year unclear | Wayback of phumyhung.vn / vnexpress tag `hcmc-run-2015`; a post-race recap |
| hcmc-run-2016 | Same "6.400" figure is in search summaries only, edition unclear | Post-race recap (Jan 2016), Wayback of the Kenh14 page |
| hcmc-run-the-city-marathon-2017 | Summary said "nearly 9,200" for the 8th HCMC Marathon, dated 16–17 Jan; our race is 2017-01-15, so edition unsure. No quotable title | Recap from Jan 2017 with the date |
| halong-bay-half-marathon-2015 | Only 82 finishers (finisher-only, not allowed) | Post-race news, Nov 2015 |
| halong-bay-heritage-marathon-2016 | Nothing found | Post-race news, Nov 2016 |
| halong-bay-heritage-marathon-2017 | The only "hơn 5.000" hit looks like the 2022 edition | Post-race news, Nov 2017 |
| vnexpress-marathon-quy-nhon-2 (2019) | Sources conflict: 3,500 (tdtt.gov.vn), ~5,000 (registered), 6,000+ | Pick the post-race figure from one recap; if two quoted sources are >25% apart the `participants-conflict` flag applies |
| vnexpress-marathon-quy-nhon-3 (2020) | Only a "hơn 10.000" qdnd title with no year (can't tie it to 2020) and "hơn 7.500" / "hơn 5.000" in summaries | A dated post-race recap |
| vnexpress-marathon-quy-nhon-5 (2023) | Count is clear (hơn 10.000) but the quotable pages (binhdinh.dcs.vn, binhdinh.gov.vn) did not load for the verifier (status 0; the cadn.com.vn copy never names 2023, correctly rejected) | Retry the pages later, or a third outlet whose page names 2023 |

### Skipped on purpose

- **Lakes Race editions** (series `andros-the-lakes-race`): skipped at the user's request. Only searched: `giai-half-trail-marathon-ho-da-2019-the-lake-race`, `andros-the-lakes-race-2019-10` (only "hơn 1.000", summary only, edition unclear) and `the-lakes-race-2022` (only orphan-guest numbers). Not searched: the rest of the series.
- Wayback copies were not tried for the HCMC and Hạ Long misses.

## Batch 6 (2026-09-29)

Stored:

| Race (slug) | Count | Source |
| --- | --- | --- |
| pocari-sweat-run-viet-nam-2022 | 6,000 | vnexpress.net |
| pocari-sweat-run-2026 | 5,000 | vtv.vn |
| vnexpress-marathon-nha-trang-2 (2022) | 8,500 (hơn) | nguoidothi.net.vn |

Follow-up, same day (the two Pocari misses, after reading the pages): stored with `web.archive.org` source links, because webthethao.vn's live URLs loop on 308 redirects and fail the verifier (Wayback copy loads).

| Race (slug) | Count | Source |
| --- | --- | --- |
| pocari-sweat-run-viet-nam-2019 | 3,200 (hơn) | webthethao.vn recap, via Wayback |
| pocari-sweat-run-viet-nam-2020 | 7,000 (hơn) | webthethao.vn post-race article, via Wayback (iwater.vn says 6,947, within 25%, not added) |

Lesson: a number seen only in a search summary is worth one page read before calling a miss. The count was on a page we could read.

### Batch: vnexpress-marathon-nha-trang series (2026-09-29)

Found 3 of 4 (75%). The series' 2022 edition was already stored.

| Race (slug) | Count | Source |
| --- | --- | --- |
| vnexpress-marathon-nha-trang-3 (2023) | 11,000 (hơn) | cadn.com.vn |
| vnexpress-marathon-nha-trang-4 (2024) | 9,000 (hơn) | nld.com.vn |
| vnexpress-marathon-nha-trang-5 (2025) | 13,000 | baovanhoa.vn |

Searched, not stored:

| Race (slug) | Why | Next thing to try |
| --- | --- | --- |
| vnexpress-marathon-nha-trang (2026) | only the pre-race 4/8 vnexpress.net article ("đón 10.000 runner") is found: an expected figure, not a count; the race-day article states none | post-race recap or results page (after mid-Aug 2026), vm.vnexpress.net/nha-trang-2026 |

### Next in the worklist

After the races above, the worklist moves on to `lam-dong-trail-2022`, `vnexpress-marathon-nha-trang-3`, `-4` and the rest of `npm run gaps` (section "Past races with no participant count"). Run `git pull` first: the apply step commits through the GitHub API, so the local checkout lags.
