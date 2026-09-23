import type { SourceHints } from "../reconcile.ts";
import type { Http } from "../http.ts";
import type { PageLink } from "../html.ts";
import type { Site, SitesConfig } from "../sites.ts";

/**
 * A recipe knows one site's layout: where its races are, and which pages and images
 * of a race hold the facts. It only makes free requests; reading what it hands back
 * is the reader's job (Firecrawl in scheduled runs). See recipes/README.md.
 */
export interface Recipe {
  /** The race pages the site lists now. */
  discover(ctx: RecipeContext): Promise<RaceRef[]>;
  /** What to read for one race. */
  snapshot(ref: RaceRef, ctx: RecipeContext): Promise<Snapshot>;
}

export type RecipeContext = {
  site: Site;
  config: SitesConfig;
  http: Http;
  /** Today in Vietnam (YYYY-MM-DD). */
  today: string;
  /** Backfill: also list races that already took place. */
  includePast: boolean;
};

export type RaceRef = {
  /** The race's page on this site; the source URL. */
  url: string;
  /** Race day when the listing shows it, so past races can be skipped without reading them. */
  date?: string;
  /** Name when the listing shows it (reports, series names). */
  name?: string;
  /** Slug for a new race (e.g. ActiUp's own). */
  slugHint?: string;
};

export type Snapshot = {
  url: string;
  /** Relevant HTML per page (lib/html.ts cleanContent), each read as one page. */
  pages: { url: string; html: string }[];
  /** Images that may hold the price table, best first. OCR'd only if the pages give no prices... */
  priceImages: string[];
  /** ...unless the site says these are its price table (e.g. ActiUp's price section): then always. */
  priceImagesCertain?: boolean;
  /** Outbound links on the race's pages, with folded anchor text. */
  links: PageLink[];
  /** Facts read for free from the site's own data (e.g. ActiUp's API); trusted over model output. */
  facts?: Record<string, unknown>;
  hints?: SourceHints;
  slugHint?: string;
};
