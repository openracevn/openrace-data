/** Normalizes a source URL so the same page always maps to the same key. */
export function canonicalSourceUrl(url: string): string {
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  u.hostname = u.hostname.replace(/^www\./, "");
  u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  return u.toString();
}
