> Reference for the `update-race` skill (plan 019). This used to be the `check-organizer` skill and no longer triggers on its own; `update-race` calls into it. Its scripts and steps are unchanged.

# Check an organizer

`data/organizers.json` holds one entity per organizing company or body (`id`, `name`, `website`, optional `links[]`). Races point at it with `organizerId` (the **primary**: the operating company a visitor deals with) and optionally `coOrganizerIds` (partners, co-hosts, media, government bodies). The site (openrace-web plan 013) shows an organizer page with a track record ("since YYYY in our data"), so a wrong or split entity misleads visitors.

## Rules

- **Report before changing.** Never split, merge or rename silently. State the proposal (primary, co-organizers, race files affected), then apply.
- Organizers are companies and bodies. No personal contacts (emails, phones of individuals). Only the organizer's own public website and Facebook page.
- Unknown stays absent. Never invent a link.
- Race fields are overrides, not hand edits: `npm run edit -- set <race> organizerId '"new-id"' --reason "<why>"` and `npm run edit -- set <race> coOrganizerIds '["a","b"]' --reason "<why>"` (see `check-race` step 5). Entities in `organizers.json` are added/edited by hand, sorted by id, in canonical format (`npm run validate` checks).
- After any change: `npm run validate` green, and the race counts before/after match (no race loses its organizer).
- Free reads first. Firecrawl costs money: say the cost first (see `check-race`).

## Checks

1. **Split check.** Does the name contain role text ("Đơn vị tổ chức/vận hành/đồng hành/đồng tổ chức", "Ban tổ chức:", "Nhà tài trợ") or several bodies joined by `,` `-` `&` `;`? Propose: the primary (the operating company/event organizer), the co-organizers, and each affected race's `organizerId` / `coOrganizerIds`. The role text stays in the race's free-text `organizer` field. Prefer the company that *runs* the event ("Đơn vị vận hành/thực hiện") over the nominal host (a Sở, UBND, newspaper, or bank).
2. **Duplicate check.** Near-identical names, case/diacritic variants, a company with and without its legal prefix ("CÔNG TY TNHH …", "Công ty CP …"): one entity. Keep the id that has the most races; move the others' races to it and drop the orphan entity.
3. **Type sanity.** Media, government, hospitals, banks and clubs are usually co-organizers, not primary. Flag, don't decide silently.
4. **Links.** Find the organizer's official site and Facebook page: race `links` first (kind `official` / `facebook`), then the official site, then web search. Record `{ "url", "kind": "official"|"facebook", "foundOn": "<host of the page it was found on>" }`. Set `website` only if it is the official site.
5. **Track record.** The page says "since YYYY in our data" from the earliest race we hold. Confirm that isn't just when we started tracking (e.g. the organizer's own site lists older editions); if so, add the older editions via `race-research`, not by editing the wording.

## Worklists

`npm run gaps` lists: organizers with merged-looking names, organizers with no links (both biggest first by race count), and races with no `organizerId` (biggest series first). It is a report, not a gate; it over-matches (a legal name with " - " is fine).

Work biggest first: the organizers with 2+ races are the ones whose page will be seen.
