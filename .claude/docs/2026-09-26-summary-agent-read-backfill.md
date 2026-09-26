# Summary, 2026-09-26: backfilling plan 008, and what it found

Backfilling 5 of plan 008's 21 upcoming races with missing price/distances/location
(`.claude/plans/008-2026-09-26-upcoming-races-missing-data.md`) surfaced two recipe
gaps, a plan built (009), a near-miss duplicate race, and a process plan (010) to close
the gaps that cost the most time. Full detail is in the commits and in
`scripts/lib/recipes/README.md`'s "Lessons from backfilling plan 008's gaps
(2026-09-26)"; this is the short version.

## What got fixed

- **`vnexpress-marathon` recipe**: now also reads `/<slug>-<year>/thong-tin-cuoc-dua`
  for venue — the race page alone never has it, registration is on-site, not linked
  out. Filled `vnexpress-marathon-nghe-an-2026`'s venue.
- **`irace` recipe** (plan 009, built this session): reads `ticket.irace.vn` (with a
  content-based fallback to `#bang-gia`'s table once registration closes and `#personal`
  is gone — its own id gets eaten by a mismatched tag on the page) and, added by hand
  only, `irace.vn/su-kien/<slug>` (an older WordPress/EventON site, `.eventon_desc_in`).
  Filled prices for `vnexpress-marathon-nghe-an-2026` (8 tiers), the-5th-edition...
  techcombank-hanoi-international-marathon (6 tiers), and
  `global-gate-halong-esg-marathon-2026` (16 tiers).
- **A duplicate race, caught and fixed**: adding techcombank-hanoi's `irace.vn` source
  created a second race (`techcombank-ha-noi-marathon-2026`) instead of merging —
  `sync.ts`'s name-similarity between the official Vietnamese name and irace.vn's
  English title scored 0.575, under the 0.65 match threshold, same race day. Fixed live
  in commits `3e176db` (merge sources, delete duplicate) and `0c4c5a4` (recompute via
  `npm run renormalize -- --commit`). `origin/main` validates clean at 328 races.

## Still open

- 2 of the 5 races (Kun Fun Run Đồng Tháp, both the main and mini-game listings) have
  no price/distances source anywhere found yet — genuinely nothing to read, not a
  recipe gap.
- 16 of plan 008's 21 races not yet attempted.
- **Plan 010** (`.claude/plans/010-2026-09-26-agent-read-process-hardening.md`, not yet
  built): a written source-finding order (same-site subpage → `ticket.irace.vn` →
  `irace.vn/su-kien` → ActiUp/poster images last, since that costs OCR), a duplicate-race
  guard in the dry run, a real "attach source to an existing race" operation (the local
  `index.json` hand-edit tried here had no effect — `syncToGitHub`'s `--commit` reads
  current state from the GitHub API, not local files), and a price pre-fill for irace's
  two text-table page shapes.
