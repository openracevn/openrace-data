/**
 * Find a race in data/index.json by id, slug, name, or a URL fragment (a source or
 * link URL). Free, read-only. Replaces the inline `python3 -c "..."` one-liner
 * `check-race` and `race-research` both used to ask an agent to retype by hand.
 *
 *   npm run find -- <query>
 */
import { readFileSync } from "node:fs";
import { INDEX_PATH, IndexSchema } from "./lib/schema.ts";

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error("usage: npm run find -- <race name, slug, id, or url fragment>");
  process.exit(1);
}
const q = query.toLowerCase();

const index = IndexSchema.parse(JSON.parse(readFileSync(INDEX_PATH, "utf8")));
const matches = index.filter(
  (e) =>
    e.id.toLowerCase().includes(q) ||
    e.slug.toLowerCase().includes(q) ||
    e.name.toLowerCase().includes(q) ||
    e.sourceUrls.some((u) => u.toLowerCase().includes(q)) ||
    e.linkUrls.some((u) => u.toLowerCase().includes(q)),
);

if (matches.length === 0) {
  console.log(`no match for "${query}" in ${INDEX_PATH}`);
  process.exit(0);
}
for (const e of matches) {
  console.log(`${e.id}  ${e.slug}  ${e.date}  ${e.name}  ${JSON.stringify(e.sourceUrls)}`);
}
console.log(`\n${matches.length} match(es).`);
