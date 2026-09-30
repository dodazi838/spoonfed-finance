import pdfParse from 'pdf-parse';
import { createHash } from 'node:crypto';
import { normalizeSourceEvidence, type SourceEvidence, type SourcePage } from './source-review';

export async function extractPdfSource(buffer: Buffer): Promise<SourceEvidence> {
  const pages: SourcePage[] = [];
  let failures = 0;
  try {
    const result = await pdfParse(buffer, { max: 200, pagerender: async (page) => {
      try {
        const content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
        let text = '', lastY: number | undefined;
        for (const item of content.items) {
          text += lastY !== undefined && lastY !== item.transform[5] ? '\n' + item.str : item.str;
          lastY = item.transform[5];
        }
        pages.push({ page: page.pageNumber, text });
        return text;
      } catch { failures++; return ''; }
    } });
    return normalizeSourceEvidence({ pages, numPages: result.numpages, fileSha256: createHash('sha256').update(buffer).digest('hex'),
      status: failures || result.numpages > 200 || pages.some(p => !p.text.trim()) ? 'partial' : 'available' });
  } catch {
    return { status: 'unavailable', pages: [], fileSha256: createHash('sha256').update(buffer).digest('hex') };
  }
}
