import type { SourceName } from "./schema.ts";

type SourceConfig = {
  hosts: readonly string[];
  /** Pages whose links are the starting point for discovering new events. */
  listings: readonly string[];
  /** Pages that describe a single event, as opposed to listings or static pages. */
  isEventPage: (url: URL) => boolean;
  /** Further listing pages linked from a listing (pagination), if the source has them. */
  isListingPage?: (url: URL) => boolean;
  /** The source's own slug for an event page, used as a new race's initial slug. */
  slugOf: (url: URL) => string;
};

export const SOURCES: Record<SourceName, SourceConfig> = {
  actiup: {
    hosts: ["actiup.net"],
    // The first 12 events. Discovery reads only this page.
    listings: ["https://actiup.net/vi/events/sports"],
    // Vietnamese pages only, so an event can't enter twice via its /en/ twin. The
    // /vi/event/<id>/tickets subpages sit behind a login and are not event pages.
    isEventPage: (u) => /^\/vi\/event\/[^/]+\/?$/.test(u.pathname),
    slugOf: (u) => u.pathname.split("/")[3] ?? "",
  },
  bibchung: {
    hosts: ["bibchung.pro"],
    // Server-rendered with real paging (/events?page=2); discovery follows the page links.
    listings: ["https://bibchung.pro/events"],
    // Vietnamese pages only (/events/<slug>); /en/events/<slug> is the English twin.
    isEventPage: (u) => /^\/events\/[^/]+\/?$/.test(u.pathname),
    isListingPage: (u) => u.pathname === "/events" && Number(u.searchParams.get("page")) >= 2,
    slugOf: (u) => u.pathname.split("/")[2] ?? "",
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
