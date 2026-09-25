---
name: opencode-read
description: Supervisor workflow for Claude Code only. Hand an agent-read batch to free opencode models as workers, then check and commit their work, to save Claude usage. Use when the user says "use opencode to read races", "let opencode do the agent read", "read the next races with free models", or wants agent-read done while using less Claude. Not for opencode itself: an opencode worker follows its prompt in worker-prompt.md, never this skill.
---

# Opencode reads, Claude supervises

The `agent-read` skill, split up: **opencode (free models) does the reading, Claude checks it and commits.** It exists because Claude usage is limited. Claude should spend tokens only on setup, on the diff between two page readings, and on checking A's reading of each price image against the image.

The race-reading case of the global `opencode-delegate` skill (`~/.claude/skills/opencode-delegate/`), which has the general rules: free models only, guard the repo, verify cheaply, only Claude commits. Nothing here spends Firecrawl credits or paid model tokens. Read `.claude/skills/agent-read/SKILL.md` first: its reading rules still hold, and this skill only changes who does the reading.

## Keep Claude's share small

- **One batch per fresh Claude session.** Claude's cost is mostly re-reading its own conversation on every step. If this session already holds unrelated work, tell the user to `/clear` and ask again.
- **20–30 races per batch.** Claude's checking barely grows with the batch; the workers do the extra. Stay at 10 for a site whose recipe or images are new to you.
- **Don't read worker logs or pages unless the compare or the dry run points at them.** Price images are the exception: check each one (step 4). `tail` the log, read the compare, check the dry run.
- Measured on the first batch (10 races): one worker used ~1.2M tokens read and ~18K written, about what Claude would spend reading the batch itself. Claude's recurring share was ~3K written, so roughly 3–5× less usage per batch once setup is done.

## Roles

| Who | Does | Never |
| --- | --- | --- |
| **Claude (supervisor)** | prepare, image copies, start workers, compare, check every price image against A's reading, fix `read.json`, dry run, commit | read pages itself when workers agree |
| **Worker A** (opencode, `--auto`) | fills `read.json` | run `prepare`, `commit`, git, or touch anything outside `.agent-read/` |
| **Worker B** (opencode, `--auto`, another model family) | fills the **pages** in `read-b.json` (no images), on its own | look at `read.json` |

Only Claude commits. `--auto` approves every tool call, so the worker prompt is the only thing keeping workers from committing. That's why the commit step belongs to Claude alone. A wrong price is worse than no price (roadmap, trust principles).

## Free models

Price images need a model that can take images. Check with `opencode models --verbose` (`capabilities.input.image` and `cost` 0):

- Can read images: `opencode/muse-spark-1.3-contributor-free` (A), `opencode/mimo-v2.6-flash-free` (B). Fallbacks: `muse-spark-1.2-contributor-free`, `space-bunny-free`.
- Text only: `big-pickle`, `nemotron-*`, `ling-*`. Don't use them for images.

Give A and B models from different families, so they don't make the same misread. B reads pages only, so a text-only model can stand in for it. The free list changes, so check it when a model fails. Write down what worked in "Notes" below.

## 1. Prepare (Claude, free)

If local `main` has diverged from `origin/main` (unpushed commits, or code changes in `scripts/` or `schema/`), run the whole batch (steps 1–5) inside the clean worktree from step 5, so prepare and commit both use `main`'s code.

```bash
git pull -q
npm run agent-read -- prepare --site actiup --limit 20
.claude/skills/opencode-read/prep.sh      # read-b.json per race + view-image-<n>.jpg copies
```

## 2. Start the workers (background)

Run both at the same time with `run_in_background`, and don't poll them: you're told when each one exits.

```bash
P=.claude/skills/opencode-read/worker-prompt.md
opencode run --auto -m opencode/muse-spark-1.3-contributor-free "$(sed 's/{{FILE}}/read.json/' $P)"   > .agent-read/worker-a.log 2>&1
opencode run --auto -m opencode/mimo-v2.6-flash-free          "$(sed 's/{{FILE}}/read-b.json/' $P)

Pages only: skip step 3, leave every image json null." > .agent-read/worker-b.log 2>&1
```

When a worker exits, don't read its whole log: `tail -20` is enough. If it died early (rate limit, model gone), run it again with a fallback model. Pages it already filled stay filled, and the prompt tells it to skip them.

**Don't wait on a slow worker B.** Once A is done, compare what B has. Read any page B hasn't reached yourself, only where the dry run looks off (for example, empty distances). Then stop B.

## 3. Compare (cheap)

```bash
node .claude/skills/opencode-read/compare.mjs .agent-read
```

This prints one line per race:

- `OK`: A and B agree on the page facts that matter (kind, types, distances, prices) and on every image's prices.
- `FORMAT`: same amounts, and only spacing, accents or an added year differ. Keep whichever follows the rules (never add a year). No need to look at the image.
- `DIFF`: a real disagreement, or a **grid gap** (a distance missing tiers the others have), with the image file to look at.
- `MISSING`: a worker didn't read that page or image. **Every image shows up as `B not read`**: B skips images on purpose, so each one goes to step 4.

**Agreement is not proof.** Both workers can skip the same cells, for example cells next to an icon, as happened on FV Run. The grid check catches most of these. Also compare the tier columns you see in the dry run with the image whenever a table looks short.

## 4. Settle the disputes (Claude)

For each `DIFF` or `MISSING`, and only for those:

- **Price images (always):** open the `view-image-<n>.jpg`, and crop in if the table is dense. Check every cell of A's reading against it, using the price lines in the dry run (step 5) side by side with the image: amounts, tier columns and dates. An image that isn't a price table (a promo banner, "from 258K") has no prices.
- **Pages:** work out which reading is right from the page HTML. For multisport races (triathlon, aquathlon), the leg lengths (750m swim, 20km bike) are not distances.
- Write the right `json` into **`read.json`**. That's what the commit reads, and `read-b.json` is ignored.
- `OK` races keep A's `read.json` as it is.

Run step 3 again until everything left is `OK` or has been settled by you.

## 5. Dry run, commit (Claude)

**First check that `git status` is clean in `scripts/` and `schema/`.** Another session may have unfinished code there, and the commit would write race files with it straight to `main`. If they're not clean (or to be safe anyway), commit from a clean worktree of `origin/main`:

```bash
W=$SCRATCH/wt-main
git fetch -q && git worktree add -q --detach "$W" origin/main
cp -R .agent-read "$W/" && ln -s "$PWD/node_modules" "$W/node_modules"
(cd "$W" && npm run agent-read -- commit .agent-read)                                        # dry run
(cd "$W" && GITHUB_TOKEN=$(gh auth token) npm run agent-read -- commit .agent-read --commit)
git worktree remove --force "$W"; rm -rf .agent-read
```

In the dry run, check names, dates, types and price kinds (`group` only for group, combo and team prices), as `agent-read` step 3 says. The changed fields should be only `types, distances, prices`. Anything else (`geo`, `courses`, ...) means the code isn't `main`'s: stop.

Tell the user: races committed, how many were `OK` straight away, how many images you had to look at, and anything left out.

## Notes (update as you learn)

- **2026-09-25, model speed (10 mixed races: 1 ActiUp, 5 VnExpress Marathon, HCMC Marathon, Hạ Long Marathon, Lâm Đồng Trail, Run to Live — 27 pages, 7 images total; this was every remaining upcoming race across all readable sites, so it was worker A's first run on the 4 race-site recipes).** A (`muse-spark-1.3-contributor-free`) finished all 27 pages + all 7 images in **~6 minutes**, including races it had never seen the recipe for (7-page HCMC Marathon, 7-page Lâm Đồng Trail). B (`mimo-v2.6-flash-free`) finished the 6 single-page races in that same window but was still stuck at 0/7, 0/1, 0/7, 0/3 pages on the 4 multi-page race-site races after **14+ minutes** — stopped and read those myself instead. **Takeaway: muse-spark-1.3 is the one to default to for both pages and images, especially on multi-page race sites; mimo-v2.6-flash struggles once a race has more than ~1 page of HTML.** B also hallucinated a type (`road_run`) on a page that named no format at all (Long Châu) — a reminder it needs page-only, low-stakes races, not a promotion to image work.
- **2026-09-25: a race-matching bug, not a model error.** The commit step (not agent-read itself) almost merged Hạ Long Marathon into an unrelated Đà Lạt race — different city, dates a day apart, `nameSimilarity` scored 0.533 against a 0.5 threshold purely from shared generic Vietnamese words ("Giải", "Quốc tế", a year). Fixed by raising `MATCH_THRESHOLD` to 0.65 in `scripts/sync.ts` (genuine near-duplicate names, e.g. Vũng Tàu City Trail spelling variants, score 1.0, well clear of the new threshold). Always read the dry run's `~` lines before committing — a race matched to a name/id that doesn't sound right is worth checking, even when compare.mjs came back all `OK`.
- Keep worker B on page-only races for now. On Đắk Lắk the page reading was the real disagreement (types, a "from 5 km" read as a distance).
- 2026-09-24, second run (10 ActiUp races, 7 images): A took ~10 min, while B had only reached race 6 of 10 and was still stuck on images. Claude checked A's 3 image tables itself (a few thousand tokens each), and all were right. B's page reading caught distances A missed (Cao Bằng). Since then, B reads pages only and Claude checks the images.
- 2026-09-24, first run (10 ActiUp races, 12 images). A = muse-spark-1.3, B = mimo-v2.6-flash; each took about 10 min and both finished. After the compare: 4 OK, 4 FORMAT, 2 DIFF. mimo adds years to `from` dates (a FORMAT diff; keep A). **Both missed the same 3 Flash Sale cells (🔥 icon) on FV Run.** Found by opening the image, which is why the grid check exists. Neither labelled relay prices as "Relay team". Claude opened 1 image and fixed 2 races.
