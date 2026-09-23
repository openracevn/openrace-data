/**
 * Wraps an image in a one-page PDF, so Firecrawl Parse can OCR it (Parse has no
 * image parser yet; see .claude/docs/design-v2.md). PNG and JPEG only: pdf-lib
 * can't embed other formats.
 */
import { PDFDocument } from "pdf-lib";

export type ImageFormat = "png" | "jpeg";

/** The image's format from its first bytes, or null if it isn't PNG or JPEG. */
export function imageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  return null;
}

export async function imageToPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const format = imageFormat(bytes);
  if (!format) throw new Error("not a PNG or JPEG image");
  const pdf = await PDFDocument.create();
  const image = format === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  const page = pdf.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  return pdf.save();
}
