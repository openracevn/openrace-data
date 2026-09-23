/**
 * HTML helpers for recipes: the main content of a page as small, stable HTML (what
 * gets read and fingerprinted), plus its links and images.
 */
import { HTMLElement, NodeType, TextNode, parse, type Node } from "node-html-parser";
import { foldVietnamese } from "./text.ts";

export type PageLink = { url: string; text: string };
export type PageImage = { url: string; alt: string };

export function parseHtml(html: string): HTMLElement {
  return parse(html, { comment: false, blockTextElements: { script: false, style: false, noscript: false, pre: true } });
}

// Never content: chrome, scripts, forms, embeds.
const DROP = new Set(["script", "style", "noscript", "svg", "iframe", "template", "nav", "footer", "form", "button", "select", "input", "textarea", "link", "meta", "video", "audio", "canvas", "object"]);
const KEEP = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "section", "article", "main", "table", "thead", "tbody", "tfoot", "tr", "td", "th",
  "ul", "ol", "li", "dl", "dt", "dd", "br", "a", "img", "strong", "b", "em", "i", "figure", "figcaption", "blockquote",
]);
const VOID = new Set(["br", "img"]);

/**
 * The page's main content as clean HTML: only structure, text, links (href) and
 * images (src, alt), with absolute URLs and no scripts, menus, footers or forms.
 * Stable across fetches of an unchanged page, so it can be fingerprinted, and small,
 * so reading it is cheap.
 */
export function cleanContent(root: HTMLElement, pageUrl: string): string {
  // Not <article>: listings use it for small cards (news, other races).
  const scope = root.querySelector("main") ?? root.querySelector("body") ?? root;
  return render(scope, pageUrl, false).replace(/\s+/g, " ").replace(/> </g, "><").trim();
}

function render(node: Node, base: string, inContent: boolean): string {
  if (node.nodeType === NodeType.TEXT_NODE) return escapeText((node as TextNode).text);
  if (node.nodeType !== NodeType.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const tag = el.rawTagName?.toLowerCase() ?? "";
  if (DROP.has(tag)) return "";
  // The site's header (logo, menu) but not a header inside the content (the article title).
  if (tag === "header" && !inContent) return "";
  const nowInContent = inContent || tag === "main" || tag === "article";
  const inner = el.childNodes.map((c) => render(c, base, nowInContent)).join("");
  if (!KEEP.has(tag)) return inner;
  if (tag === "img") {
    const src = imageSrc(el, base);
    return src ? `<img src="${escapeAttr(src)}" alt="${escapeAttr(el.getAttribute("alt") ?? "")}">` : "";
  }
  if (tag === "br") return "<br>";
  if (!inner.trim() && !VOID.has(tag)) return "";
  if (tag === "a") {
    const href = absoluteUrl(el.getAttribute("href"), base);
    return href ? `<a href="${escapeAttr(href)}">${inner}</a>` : inner;
  }
  const span = ["td", "th"].includes(tag)
    ? ["colspan", "rowspan"].map((a) => (el.getAttribute(a) ? ` ${a}="${escapeAttr(el.getAttribute(a)!)}"` : "")).join("")
    : "";
  return `<${tag}${span}>${inner}</${tag}>`;
}

/** Every link on the page with its folded anchor text, absolute and without #fragments. */
export function pageLinks(root: HTMLElement, pageUrl: string): PageLink[] {
  const out = new Map<string, PageLink>();
  for (const a of root.querySelectorAll("a[href]")) {
    const url = absoluteUrl(a.getAttribute("href"), pageUrl);
    if (!url || !/^https?:/.test(url)) continue;
    const text = foldVietnamese(`${a.textContent} ${a.getAttribute("title") ?? ""}`).slice(0, 120);
    const seen = out.get(url);
    if (!seen || (!seen.text && text)) out.set(url, { url, text });
  }
  return [...out.values()];
}

/** Every content image on the page, largest variant first choice, deduped. */
export function pageImages(root: HTMLElement, pageUrl: string): PageImage[] {
  const out = new Map<string, PageImage>();
  for (const img of root.querySelectorAll("img")) {
    const url = imageSrc(img, pageUrl);
    if (!url) continue;
    const key = imageKey(url);
    if (!out.has(key)) out.set(key, { url, alt: img.getAttribute("alt") ?? "" });
  }
  return [...out.values()];
}

/** The best source of an <img>: the widest srcset candidate, a lazy-load source, or src. */
export function imageSrc(img: HTMLElement, base: string): string | null {
  const srcset = img.getAttribute("srcset") ?? img.getAttribute("data-srcset");
  let best: string | null = null;
  if (srcset) {
    let bestWidth = -1;
    for (const part of srcset.split(",")) {
      const [u, w] = part.trim().split(/\s+/);
      const width = w?.endsWith("w") ? Number(w.slice(0, -1)) : 0;
      if (u && width > bestWidth) [best, bestWidth] = [u, width];
    }
  }
  const raw = best ?? img.getAttribute("data-src") ?? img.getAttribute("data-lazy-src") ?? img.getAttribute("src");
  const url = absoluteUrl(raw, base);
  if (!url || /\.svg(\?|$)/i.test(url) || !/^https?:/.test(url)) return null;
  return url;
}

/** Same image in another size (WordPress "-1024x512", "-scaled") → one key. */
export function imageKey(url: string): string {
  return url.replace(/[?#].*$/, "").replace(/(-\d+x\d+|-scaled)+(?=\.\w+$)/g, "");
}

/** The image's file name, decoded and folded, for keyword matching ("BANG-GIA-EB-HBHM.png" → "bang gia eb hbhm png"). */
export function imageName(url: string): string {
  let name = url.replace(/[?#].*$/, "").split("/").pop() ?? "";
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep as is
  }
  return foldVietnamese(name);
}

export function absoluteUrl(href: string | undefined | null, base: string): string | null {
  if (!href || /^(javascript|mailto|tel|data):/i.test(href.trim())) return null;
  try {
    const u = new URL(href.trim(), base);
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function escapeText(s: string): string {
  return s.replace(/&(?![a-z]+;|#\d+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
