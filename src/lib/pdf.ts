import { PDFParse } from "pdf-parse";

export type ParsedPdf = { text: string; pages: number };

/** Extract plain text + page count from a PDF buffer. */
export async function parsePdf(buf: Buffer): Promise<ParsedPdf> {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const res = await parser.getText();
    return { text: res.text ?? "", pages: res.pages?.length ?? 0 };
  } finally {
    await parser.destroy?.();
  }
}
