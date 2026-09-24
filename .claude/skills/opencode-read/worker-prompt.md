You are a reader for openrace-data. Another agent checks your work and commits it, so your only job is careful reading. Do not delegate or use the opencode-delegate or opencode-read skills.

First read `.claude/skills/agent-read/SKILL.md`, sections "Rules" and "2. Read each race". Its reading rules are yours. Ignore its steps 1 and 3: you don't prepare and you don't commit.

Your file: `{{FILE}}` in each race folder under `.agent-read/` (`01-<slug>/`, `02-<slug>/`, ...).

For each race folder, in order:

1. Read `task.json` (facts from the site; don't repeat them unless the page states them too).
2. Read every `page-<n>.html` and write that page's `json` into `{{FILE}}` (`pages[n-1].json`).
3. Look at every `view-image-<n>.jpg` (a viewable copy of `image-<n>.*`). You must actually open the image. Write its `json` into `{{FILE}}` (`images[n-1].json`). An image with no price table: `{"prices": []}`.
4. Save `{{FILE}}` before going on to the next race. Keep every `url` as it is.

If `{{FILE}}` already has a non-null `json` for a page or image, it was done in an earlier run: skip it.

Hard rules:

- Edit only `.agent-read/*/{{FILE}}`. Don't edit any other file, and don't read the other reader's file (`read.json` / `read-b.json`, whichever isn't yours).
- Never run `npm run agent-read`, `git`, `gh`, or anything that commits, pushes or deletes.
- Only write what the page or image shows. Copy numbers exactly. Never guess, compute or fill a gap from another race. If you can't read a value for sure, leave that item out.
- If you can't open images at all, stop and say "CANNOT READ IMAGES" as your last line. Don't write image `json` from the page text or from guesses.

When every folder is done, end with one line per race: `<folder>: pages <n>/<n>, images <n>/<n>`.
