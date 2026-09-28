import { foldVietnamese } from "./text.ts";

/** A count someone found for one edition, before anything is trusted or stored. */
export type Candidate = {
  /** Race slug or id. */
  race: string;
  /** The page that states the count. */
  url: string;
  count: number;
  /** Verbatim text from the page or its title. Omit for a number seen only in a search summary (stored as low confidence). */
  quote?: string;
};

export type Page = { ok: boolean; status: number; title: string; text: string };

export type Verdict = { ok: true; quote: string | null } | { ok: false; reason: string };

// Wordings that are not "registered, paid or attended": targets, capacity, finishers only.
const REJECTED = /d[uự] ki[eế]n|h[uư][oớ]ng t[oớ]i|k[yỳ] v[oọ]ng|m[uụ]c ti[eê]u|gi[oớ]i h[aạ]n|ch[iỉ] ti[eê]u|v[eề] [dđ][ií]ch|\b(expect(ed)?|target(ed)?|aims?|capacity|slots?|quota|finish(ed|ers?))\b/i;

/** Every whole number written in the text, with `.`, `,` or a space as thousands separator ("15.000", "13,117", "15 000"). */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d{1,3}(?:[.,\s]\d{3})+|\d+/g)) out.push(Number(m[0].replace(/[.,\s]/g, "")));
  return out;
}

const squash = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

/** The page text and title, tags and scripts removed. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const text = html
    .replace(/<(script|style|noscript|title)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ");
  return { title: decode(title), text: decode(text) };
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

export async function fetchPage(url: string): Promise<Page> {
  try {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (openrace-data backfill-verify)" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    const { title, text } = htmlToText(await res.text());
    return { ok: res.ok, status: res.status, title, text };
  } catch (err) {
    return { ok: false, status: 0, title: "", text: String((err as Error).message) };
  }
}

/**
 * Accept a candidate only when: the link loads and is not Facebook, the edition's year is on
 * the page (a count for another edition is rejected), the count is in the quote, the quote
 * is verbatim on the page or its title, and it doesn't read as a target, capacity or finishers.
 * Without a quote, the count itself must appear on the page (low confidence).
 */
export function verifyCandidate(c: Candidate, raceYear: string, page: Page): Verdict {
  if (/(^|\.)(facebook|fb)\.com\b/i.test(new URL(c.url).hostname)) return { ok: false, reason: "Facebook is not a source" };
  if (!page.ok) return { ok: false, reason: `link does not load (status ${page.status})` };
  if (!Number.isInteger(c.count) || c.count < 1) return { ok: false, reason: "count must be an integer >= 1" };
  const haystack = squash(`${page.title}\n${page.text}\n${c.url}`);
  if (!haystack.includes(raceYear)) return { ok: false, reason: `the page never mentions ${raceYear}: wrong edition?` };
  const quote = c.quote?.trim();
  if (!quote) {
    if (!numbersIn(`${page.title} ${page.text}`).includes(c.count)) return { ok: false, reason: `${c.count} is not on the page` };
    return { ok: true, quote: null };
  }
  if (quote.length > 200) return { ok: false, reason: "quote is longer than 200 characters" };
  if (REJECTED.test(quote)) return { ok: false, reason: "quote reads as a target, capacity or finishers-only count" };
  if (!numbersIn(quote).includes(c.count)) return { ok: false, reason: `${c.count} is not in the quote` };
  if (!squash(`${page.title}\n${page.text}`).includes(squash(quote))) return { ok: false, reason: "quote is not verbatim on the page or its title" };
  return { ok: true, quote };
}
