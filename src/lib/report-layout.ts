/** Keep selection, Markdown exports and chart rendering consistent. */
export function chaptersInReportOrder(chapters: string[], selected: string[]): string[] {
  const selection = new Set(selected);
  return [...new Set(chapters)].filter(chapter => selection.has(chapter));
}

export function splitLongBullets(markdown: string, limit = 180): string {
  let fenced = false;
  return markdown.split('\n').map(line => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced || !line.startsWith('- ') || line.replace(/<[^>]+>/g, '').length <= limit) return line;
    // Break at sentence boundaries; decimals, tables and nested lists remain intact.
    const sentences = line.slice(2).split(/(?<=[.!?])\s+(?=[가-힣A-Za-z*<])/);
    const paragraphs: string[] = [];
    let paragraph = '';
    for (const sentence of sentences) {
      if (paragraph && `${paragraph} ${sentence}`.replace(/<[^>]+>/g, '').length > limit) {
        paragraphs.push(paragraph);
        paragraph = sentence;
      } else paragraph += (paragraph ? ' ' : '') + sentence;
    }
    if (paragraph) paragraphs.push(paragraph);
    return '- ' + paragraphs.join('\n\n  ');
  }).join('\n');
}

export interface ChartSeries { key: string; unit: string; basis?: string }
export interface QualityChart {
  title: string; type?: 'line' | 'area' | 'bar' | 'pie'; unit?: string; dataKeys?: string[];
  series?: ChartSeries[]; colors?: string[]; data: Record<string, unknown>[];
  source?: string; sourcePages?: number[]; description?: string; notes?: string[];
}

export function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^-?\d+(?:,\d{3})*(?:\.\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function chartDomain(data: Record<string, unknown>[], keys: string[], baseline = false): [number, number] {
  const values = data.flatMap(row => keys.map(key => numericValue(row[key])).filter((v): v is number => v !== null));
  if (!values.length) return [0, 1];
  let min = Math.min(...values), max = Math.max(...values);
  if (baseline) { min = Math.min(0, min); max = Math.max(0, max); }
  const padding = (max - min) * 0.1 || Math.abs(max) * 0.05 || 1;
  return [min === 0 && baseline ? 0 : Math.floor((min - padding) * 100) / 100,
    max === 0 && baseline ? 0 : Math.ceil((max + padding) * 100) / 100];
}

function frequency(row: Record<string, unknown>): string {
  if (['year', 'quarter', 'month', 'day', 'category'].includes(String(row.periodType))) return String(row.periodType);
  const name = String(row.name || '').trim();
  if (/분기|[1-4]\s*\/\s*4|Q[1-4]|[1-4]Q/i.test(name)) return 'quarter';
  if (/\d{4}-\d{2}-\d{2}|일$|\d{1,2}\.\d{1,2}\.\d{1,2}/.test(name)) return 'day';
  if (/월|^\d{2,4}[.\/-]\d{1,2}$/.test(name)) return 'month';
  if (/연간|연말|년말|^\d{2,4}년?$/.test(name)) return 'year';
  return 'category';
}

const PERIOD_LABEL: Record<string, string> = { year: '연간', quarter: '분기', month: '월간', day: '일간', category: '기간 확인 필요' };

export function prepareCharts(chart: QualityChart): QualityChart[] {
  const keys = chart.dataKeys?.length ? chart.dataKeys : ['value'];
  const units = (chart.unit || '').split(/[,，/]/).map(s => s.trim()).filter(Boolean);
  const suppliedSeries = Array.isArray(chart.series) ? chart.series : [];
  const series = keys.map(key => {
    const explicit = suppliedSeries.find(s => s.key === key && typeof s.unit === 'string' && s.unit.trim());
    if (explicit) return explicit;
    if (units.length <= 1) return { key, unit: units[0] || '단위 확인 필요', basis: '' };
    // Only the explicit rate/amount legacy case can be inferred safely.
    if (units.length === 2 && units.includes('%') && /율|률|금리|비율|%/.test(key)) return { key, unit: '%', basis: '' };
    if (units.length === 2 && units.includes('%') && /수지|금액|규모|잔액|대출액/.test(key)) return { key, unit: units.find(u => u !== '%')!, basis: '' };
    return { key, unit: `단위 확인 필요 (${key})`, basis: '' };
  });
  const groups = new Map<string, ChartSeries[]>();
  for (const item of series) {
    const group = `${item.unit}\u0000${item.basis || ''}`;
    groups.set(group, [...(groups.get(group) || []), item]);
  }
  const data = (Array.isArray(chart.data) ? chart.data : []).map(row => {
    const normalized = { ...row };
    for (const key of keys) normalized[key] = numericValue(row[key]);
    return normalized;
  });
  const periods = new Map<string, Record<string, unknown>[]>();
  for (const row of data) {
    const kind = frequency(row);
    periods.set(kind, [...(periods.get(kind) || []), row]);
  }
  const splitPeriods = periods.size > 1 && chart.type !== 'pie';
  const result: QualityChart[] = [];
  for (const group of groups.values()) {
    const slices = splitPeriods ? [...periods] : [['', data] as const];
    for (const [period, rows] of slices) {
      const labels = [groups.size > 1 ? group[0].unit : '', group[0].basis || '', period ? PERIOD_LABEL[period] : ''].filter(Boolean);
      const notes = [...(chart.notes || [])];
      if (splitPeriods) notes.push('분기·월간 등 집계 기간을 분리했습니다. 서로 다른 기간의 수치를 연속 추이로 연결하지 않습니다.');
      if (group[0].unit.includes('확인 필요')) notes.push('시리즈별 단위 정보가 부족합니다. 원문에서 단위를 확인해 주세요.');
      if (rows.some(row => group.some(s => row[s.key] === null))) notes.push('결측치는 빈 구간으로 표시했습니다. 0은 실제 값이 0인 경우에만 표시합니다.');
      if (chart.type === 'pie' && rows.some(row => group.some(s => typeof row[s.key] === 'number' && (row[s.key] as number) < 0))) notes.push('음수는 비중으로 표현할 수 없어 막대그래프로 표시했습니다.');
      result.push({ ...chart, type: notes.some(n => n.startsWith('음수는')) ? 'bar' : chart.type,
        title: chart.title + (labels.length ? ` · ${labels.join(' / ')}` : ''), unit: group[0].unit,
        series: group, dataKeys: group.map(s => s.key), colors: group.map(s => chart.colors?.[keys.indexOf(s.key)] || ''),
        data: rows, notes: [...new Set(notes)] });
    }
  }
  return result;
}
