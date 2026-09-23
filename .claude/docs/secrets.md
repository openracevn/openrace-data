# Secrets and config

Names and locations only. **Never write secret values into this repo.** Local values go in `.env` (gitignored, chmod 600).

| Name | Used by | Where it's set | Status (2026-09-23) |
| --- | --- | --- | --- |
| `FIRECRAWL_API_KEY` | `check.ts` | Actions secret, `.env` | set in `.env`; **Actions secret not set** |
| `OPENRACE_BOT_TOKEN` (Actions) / `GITHUB_TOKEN` (local `.env`) | `check.ts`, `sync-cli.ts` (commits) | Actions secret, `.env` | **not created yet** |
| `GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_BRANCH` | `check.ts`, `sync-cli.ts` | derived from the repo in `check.yml`; `.env` locally | `openracevn` / `openrace-data` / `main` |
| `DISCORD_WEBHOOK_URL` | `notify-discord` job | Actions secret, `.env` | **set** in both (validated with a GET; no message sent yet) |
| `SYNC_WEBHOOK_URL` | `notify-api` job | Actions secret | not set on purpose: placeholder until openrace-api exists; the job logs "skipping" |

## Notes

- **`OPENRACE_BOT_TOKEN` must be a PAT or GitHub App token**, not Actions' built-in `GITHUB_TOKEN`. Pushes made with the built-in token don't trigger workflows, which would silently skip validation and notifications. Use a fine-grained PAT scoped to `openracevn/openrace-data` with *Contents: read and write* only. (Secret names can't start with `GITHUB_`, hence the different name in Actions.)
- **Firecrawl MCP for Claude Code** is registered at local scope in `~/.claude.json`, not in this repo: `https://mcp.firecrawl.dev/v2/mcp` with an `Authorization: Bearer` header taken from `.env`.
- The Discord webhook URL was pasted in a Claude session on 2026-09-23. If that matters, regenerate it in Discord and update both `.env` and the Actions secret.
- To set a secret from `.env` without the value appearing in shell history:
  `grep '^NAME=' .env | cut -d= -f2- | tr -d '\n' | gh secret set NAME --repo openracevn/openrace-data`
- Obsolete since the Worker was removed: `FIRECRAWL_WEBHOOK_SECRET`, `INGEST_WEBHOOK_URL`, and the Worker secrets. None of them were ever set.
