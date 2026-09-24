---
name: opencode-read
description: Supervisor workflow for Claude Code only. Hand an agent-read batch to free opencode models as workers, then check and commit their work, to save Claude usage. Use when the user says "use opencode to read races", "let opencode do the agent read", "read the next races with free models", or wants agent-read done while using less Claude. Not for opencode itself: an opencode worker follows its prompt in worker-prompt.md, never this skill.
---

# Opencode reads, Claude supervises

The `agent-read` skill, split up: **opencode (free models) does the reading, Claude checks it and commits.** It exists because Claude usage is limited. Claude should spend tokens only on setup, on the diff between two readings, and on the images where they disagree.

The race-reading case of the global `opencode-delegate` skill (`~/.claude/skills/opencode-delegate/`), which has the general rules: free models only, guard the repo, verify cheaply, only Claude commits. Nothing here spends Firecrawl credits or paid model tokens. Read `.claude/skills/agent-read/SKILL.md` first: its reading rules still hold, and this skill only changes who does the reading.

## Roles

| Who | Does | Never |
| --- | --- | --- |
| **Claude (supervisor)** | prepare, image copies, start workers, compare, look at disputed images, fix `read.json`, dry run, commit | read every image itself when workers agree |
| **Worker A** (opencode, `--auto`) | fills `read.json` | run `prepare`, `commit`, git, or touch anything outside `.agent-read/` |
| **Worker B** (opencode, `--auto`, another model family) | fills `read-b.json`, on its own | look at `read.json` |

Only Claude commits. `--auto` approves every tool call, so the worker prompt is the only thing keeping workers from committing. That's why the commit step belongs to Claude alone. A wrong price is worse than no price (roadmap, trust principles).

## Free models

Price images need a model that can take images. Check with `opencode models --verbose` (`capabilities.input.image` and `cost` 0):

- Can read images: `opencode/muse-spark-1.3-contributor-free` (A), `opencode/mimo-v2.6-flash-free` (B). Fallbacks: `muse-spark-1.2-contributor-free`, `space-bunny-free`.
- Text only: `big-pickle`, `nemotron-*`, `ling-*`. Don't use them for images.

Give A and B models from different families, so they don't make the same misread. The free list changes, so check it when a model fails. Write down what worked in "Notes" below.

## 1. Prepare (Claude, free)

```bash
git pull -q
npm run agent-read -- prepare --site actiup --limit 10
.claude/skills/opencode-read/prep.sh      # read-b.json per race + view-image-<n>.jpg copies
```

## 2. Start the workers (background)

Run both at the same time with `run_in_background`, and don't poll them: you're told when each one exits.

```bash
P=.claude/skills/opencode-read/worker-prompt.md
opencode run --auto -m opencode/muse-spark-1.3-contributor-free "$(sed 's/{{FILE}}/read.json/' $P)"   > .agent-read/worker-a.log 2>&1
opencode run --auto -m opencode/mimo-v2.6-flash-free          "$(sed 's/{{FILE}}/read-b.json/' $P)" > .agent-read/worker-b.log 2>&1
```

When a worker exits, don't read its whole log: `tail -20` is enough. If it died early (rate limit, model gone), run it again with a fallback model. Pages it already filled stay filled, and the prompt tells it to skip them.

## 3. Compare (cheap)

```bash
node .claude/skills/opencode-read/compare.mjs .agent-read
```

This prints one line per race:

- `OK`: A and B agree on the page facts that matter (kind, types, distances, prices) and on every image's prices.
- `FORMAT`: same amounts, and only spacing, accents or an added year differ. Keep whichever follows the rules (never add a year). No need to look at the image.
- `DIFF`: a real disagreement, or a **grid gap** (a distance missing tiers the others have), with the image file to look at.
- `MISSING`: a worker didn't read that page or image.

**Agreement is not proof.** Both workers can skip the same cells, for example cells next to an icon, as happened on FV Run. The grid check catches most of these. Also compare the tier columns you see in the dry run with the image whenever a table looks short.

## 4. Settle the disputes (Claude)

For each `DIFF` or `MISSING`, and only for those:

- Open the `view-image-<n>.jpg` it names, and crop in if the table is dense. Work out which reading is right, or read it yourself.
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

- 2026-09-24, first run (10 ActiUp races, 12 images). A = muse-spark-1.3, B = mimo-v2.6-flash; each took about 10 min and both finished. After the compare: 4 OK, 4 FORMAT, 2 DIFF. mimo adds years to `from` dates (a FORMAT diff; keep A). **Both missed the same 3 Flash Sale cells (🔥 icon) on FV Run.** Found by opening the image, which is why the grid check exists. Neither labelled relay prices as "Relay team". Claude opened 1 image and fixed 2 races.
