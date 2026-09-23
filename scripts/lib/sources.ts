import type { SourceName } from "./schema.ts";

type SourceConfig = {
  hosts: readonly string[];
  /** Pages whose links are the starting point for discovering new events. */
  listings: readonly string[];
  /** Pages that describe a single event, as opposed to listings or static pages. */
  isEventPage: (url: URL) => boolean;
};

export const SOURCES: Record<SourceName, SourceConfig> = {
  actiup: {
    hosts: ["actiup.net"],
    // Shows ~12 upcoming events; each event page links to more ("Có thể bạn sẽ thích").
    listings: ["https://actiup.net/vi/events/sports"],
    // Vietnamese pages only, so an event can't enter twice via its /en/ twin. The
    // /vi/event/<id>/tickets subpages sit behind a login and are not event pages.
    isEventPage: (u) => /^\/vi\/event\/[^/]+\/?$/.test(u.pathname),
  },
};

/** The source a URL belongs to, or null if it isn't an event page from a known source. */
export function sourceForUrl(url: string): SourceName | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  for (const [name, cfg] of Object.entries(SOURCES) as [SourceName, SourceConfig][]) {
    if (cfg.hosts.includes(host) && cfg.isEventPage(u)) return name;
  }
  return null;
}
