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
