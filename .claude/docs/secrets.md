# Secrets and config

Names and locations only. **Never write secret values into this repo.** Local values go in `.env` (gitignored, chmod 600).

| Name | Used by | Where it's set | Status (2026-09-23) |
| --- | --- | --- | --- |
| `FIRECRAWL_WEBHOOK_SECRET` | Worker (HMAC verify) | `wrangler secret put` | **not set** |
| `FIRECRAWL_API_KEY` | Worker (read checks), `create-monitor.ts` | `wrangler secret put`, `.env` | **not set** |
| `GITHUB_TOKEN` | Worker, `sync-cli.ts` | `wrangler secret put`, `.env` | **not set** |
| `GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_BRANCH` | Worker, `sync-cli.ts` | `worker/wrangler.toml` `[vars]`, `.env` | set: `openracevn` / `data` / `main` |
| `DISCORD_WEBHOOK_URL` | `notify-discord` job | GitHub Actions secret, `.env` | **set** in both (webhook validated with a GET; no message sent yet) |
| `SYNC_WEBHOOK_URL` | `notify-api` job | GitHub Actions secret | not set on purpose: placeholder until openrace-api exists; the job logs "skipping" |
| `INGEST_WEBHOOK_URL` | `create-monitor.ts` | `.env` | not set (needs the deployed Worker URL) |

## Notes

- **`GITHUB_TOKEN` must be a PAT or GitHub App token**, not Actions' built-in `GITHUB_TOKEN`: pushes made with the built-in token don't trigger workflows, which would silently skip validation and notifications. Use a fine-grained PAT scoped to `openracevn/data` with *Contents: read and write* only.
- **`FIRECRAWL_WEBHOOK_SECRET`** is the account-wide secret from firecrawl.dev → Settings → Advanced. Regenerating it there breaks the Worker until the Worker secret is updated.
- For `npm run worker:dev`, put the Worker secrets in `worker/.dev.vars` (gitignored), or pass `--var NAME:value`.
- The Discord webhook URL was pasted in a Claude session on 2026-09-23. If that matters, regenerate it in Discord and update both `.env` and the Actions secret. To set a secret from `.env` without the value appearing in shell history:
  `grep '^NAME=' .env | cut -d= -f2- | tr -d '\n' | gh secret set NAME --repo openracevn/data`
