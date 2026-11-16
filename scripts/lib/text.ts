/** Lowercase, strip Vietnamese diacritics and punctuation: "TP. Hồ Chí Minh" -> "tp ho chi minh". */
export function foldVietnamese(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Trimmed single-spaced string, or null for anything empty or not a string. */
export function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ") : null;
}

/** Dice coefficient over character bigrams of the folded name, spaces removed. */
export function nameSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const t = foldVietnamese(s).replace(/\s+/g, "");
    const out = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) out.set(t.slice(i, i + 2), (out.get(t.slice(i, i + 2)) ?? 0) + 1);
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  let shared = 0;
  let total = 0;
  for (const n of ga.values()) total += n;
  for (const n of gb.values()) total += n;
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) ?? 0);
  return total === 0 ? 0 : (2 * shared) / total;
}
