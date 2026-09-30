import type { SourceEvidence } from './source-review';

export interface SourceChapter {
  title: string; startPage: number; endPage: number; startHeading: string; endHeading?: string;
}

/** Conservative structural fallback: sequential Roman roots, then numbered appendices.
 * Roman headings inside an appendix remain children of that appendix. */
export function extractSourceChapters(source: SourceEvidence): SourceChapter[] {
  const headings: { title: string; page: number; anchor: string }[] = [];
  let lastRoman = 0, inAppendix = false;
  const romanNumbers = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  for (const page of [...source.pages].sort((a, b) => a.page - b.page)) {
    const lines = page.text.split('\n');
    for (let index = 0; index < lines.length; index++) {
      const anchor = lines[index].trim();
      const normalized = anchor.normalize('NFKC');
      const appendix = normalized.match(/^[<\[]\s*(붙임|부록|별첨|첨부)\s*(\d+)\s*[>\]]\s*(.*)$/);
      if (appendix) {
        const body = appendix[3] || lines.slice(index + 1).find(line => line.trim() && !/^-\s*\d+\s*-$/.test(line.trim()))?.trim();
        if (!body || headings.some(h => h.title.startsWith(`${appendix[1]} ${appendix[2]} ·`))) continue;
        headings.push({ title: `${appendix[1]} ${appendix[2]} · ${body}`, page: page.page, anchor });
        inAppendix = true;
        continue;
      }
      if (inAppendix) continue;
      const roman = normalized.match(/^([IVX]+)(?:[.\s]|(?=[가-힣]))\s*(.{2,120})$/);
      if (!roman) continue;
      const number = romanNumbers.indexOf(roman[1]) + 1;
      if (number !== lastRoman + 1) continue;
      headings.push({ title: roman[2].trim(), page: page.page, anchor });
      lastRoman = number;
    }
  }
  // Avoid overriding the model when only isolated or ambiguous headings were found.
  if (lastRoman < 2 || headings.length > 7 || source.status !== 'available') return [];
  return headings.map((heading, index) => ({ title: `${index + 1}. ${heading.title}`, startPage: heading.page,
    endPage: headings[index + 1]?.page || source.numPages || source.pages.at(-1)?.page || heading.page,
    startHeading: heading.anchor, ...(headings[index + 1] ? { endHeading: headings[index + 1].anchor } : {}),
  }));
}

export function chapterSource(source: SourceEvidence, chapter?: SourceChapter): SourceEvidence {
  if (!chapter) return source;
  return { ...source, pages: source.pages.filter(p => p.page >= chapter.startPage && p.page <= chapter.endPage).map(page => {
    let text = page.text;
    if (page.page === chapter.startPage) {
      const start = text.indexOf(chapter.startHeading);
      if (start >= 0) text = text.slice(start);
    }
    if (page.page === chapter.endPage && chapter.endHeading) {
      const end = text.indexOf(chapter.endHeading);
      if (end >= 0) text = text.slice(0, end);
    }
    return { ...page, text };
  }).filter(page => page.text.trim()) };
}

export function chapterScopePrompt(chapter?: SourceChapter): string {
  if (!chapter) return '';
  return `\n[원문 제목으로 확정한 분석 범위 · 앞의 일반 범위 설명보다 우선]\nPDF ${chapter.startPage}쪽의 "${chapter.startHeading}"부터 ` +
    (chapter.endHeading ? `${chapter.endPage}쪽의 "${chapter.endHeading}" 직전까지` : `PDF ${chapter.endPage}쪽 끝까지`) +
    ' 분석하세요. 다음 범위의 내용은 제외합니다. 이 범위 안의 아라비아 숫자 소제목, 참고·박스, 붙임 내부의 I·II 제목은 하위 항목입니다. 하위 항목에서 조기 종료하지 마세요.';
}
