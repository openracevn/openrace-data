/**
 * The site list (config/sites.yaml): which sites are read, how and how often, and
 * which domains are recognized when a page links to them.
 */
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import type { LinkKind, SourceRole } from "./schema.ts";

export const SITES_PATH = "config/sites.yaml";

export const SITE_KINDS = ["seller", "hub", "race-site"] as const;
export const CADENCES = ["weekly", "monthly", "quarterly", "yearly", "manual"] as const;

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected kebab-case");
const entity = z.object({ id: slug, name: z.string().min(1), website: z.url().optional() });

export const SiteSchema = z
  .object({
    key: slug,
    name: z.string().min(1),
    kind: z.enum(SITE_KINDS),
    url: z.url(),
    hosts: z.array(z.string().min(1)).optional(),
    recipe: z.string().min(1),
    check: z.enum(CADENCES).default("manual"),
    series: entity.optional(),
    organizer: entity.optional(),
  })
  .transform((s) => ({ ...s, hosts: s.hosts ?? [hostOf(s.url)] }));

export const SitesConfigSchema = z.object({
  monthlyCredits: z.number().int().nonnegative(),
  sites: z.array(SiteSchema).superRefine((sites, ctx) => {
    const keys = new Set<string>();
    const hosts = new Map<string, string>();
    for (const [i, s] of sites.entries()) {
      if (keys.has(s.key) || s.key === "openrace") ctx.addIssue({ code: "custom", message: `duplicate or reserved key ${s.key}`, path: [i, "key"] });
      keys.add(s.key);
      for (const h of s.hosts) {
        if (hosts.has(h)) ctx.addIssue({ code: "custom", message: `host ${h} is used by ${hosts.get(h)} and ${s.key}`, path: [i, "hosts"] });
        hosts.set(h, s.key);
      }
    }
  }),
});

export type Site = z.infer<typeof SiteSchema>;
export type SitesConfig = z.infer<typeof SitesConfigSchema>;
export type Cadence = (typeof CADENCES)[number];

export function loadSites(path = SITES_PATH): SitesConfig {
  return parseSites(readFileSync(path, "utf8"));
}

export function parseSites(text: string): SitesConfig {
  return SitesConfigSchema.parse(parse(text));
}

/** Days between scheduled reads; manual sites are only read on request. */
export const CADENCE_DAYS: Record<Cadence, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 91,
  yearly: 365,
  manual: Number.POSITIVE_INFINITY,
};

/** Race sites and hubs speak for their own races; sellers only sell them. */
export function roleOf(site: Site): SourceRole {
  return site.kind === "seller" ? "seller" : "official";
}

export function hostOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
}

/** The configured site a URL belongs to (its host, or a parent domain of it), or null. */
export function siteForUrl(config: SitesConfig, url: string): Site | null {
  let host: string;
  try {
    host = hostOf(url);
  } catch {
    return null;
  }
  for (let h = host; h.includes("."); h = h.slice(h.indexOf(".") + 1)) {
    const site = config.sites.find((s) => s.hosts.includes(h));
    if (site) return site;
  }
  return null;
}

const FACEBOOK = /(^|\.)(facebook\.com|fb\.com|fb\.me|m\.me)$/;
const RULES_TEXT = /quy (dinh|che)|dieu le|the le|rules|regulation|waiver|mien tru/;
const RESULTS_TEXT = /ket qua|result/;

/**
 * What a link on a race page is. `text` is the folded anchor text (lowercase, no
 * diacritics), used for documents whose URL says nothing (Google Docs, Drive).
 */
export function classifyLink(config: SitesConfig, url: string, text = ""): { kind: LinkKind; site: Site | null } {
  const site = siteForUrl(config, url);
  if (site) return { kind: site.kind === "seller" ? "seller" : "official", site };
  let host = "";
  let path = "";
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./, "");
    path = u.pathname.toLowerCase();
  } catch {
    return { kind: "other", site: null };
  }
  if (FACEBOOK.test(host)) return { kind: "facebook", site: null };
  const words = `${text} ${path.replace(/[^a-z0-9]+/g, " ")}`;
  if (RESULTS_TEXT.test(words)) return { kind: "results", site: null };
  if (RULES_TEXT.test(words)) return { kind: "rules", site: null };
  return { kind: "other", site: null };
}
