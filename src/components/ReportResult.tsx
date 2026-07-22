'use client';

import { Check, Copy, CheckCircle2, TrendingUp, BookOpen, FileText, Download, Loader2, Camera } from 'lucide-react';
import { 
  BarChart, Bar, 
  LineChart, Line, 
  PieChart, Pie, Cell,
  AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LabelList, Legend 
} from 'recharts';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { marked } from 'marked';
import html2canvas from 'html2canvas';
import styles from './ReportResult.module.css';

// Corporate Light Theme Colors (e.g., Deep Blue, Teal, Amber, Navy, Purple, Rose)
const COLORS = ['#2563eb', '#0f766e', '#f59e0b', '#0369a1', '#6d28d9', '#be123c'];

// Fix markdown tables that AI outputs on a single line (e.g. "|A|B| |C|D|")
// by splitting them into proper multi-line format for remarkGfm to parse.
function fixMarkdownTables(text: any): string {
  if (!text) return '';
  if (Array.isArray(text)) {
    text = text.join('\n');
  } else if (typeof text !== 'string') {
    text = String(text);
  }

  // Pattern: a pipe at end of a cell row, whitespace, then pipe starting next row
  // e.g. "...내용입니다| |주요 투자..." → "...내용입니다|\n|주요 투자..."
  let fixed = text.replace(/\|\s{1,3}\|/g, '|\n|');
  
  // Ensure there's a blank line before a table starts (required by GFM)
  fixed = fixed.replace(/([^\n])\n(\|[^\n]+\|)\n(\|[\s:|-]+\|)/g, '$1\n\n$2\n$3');
  
  return fixed;
}

export interface ChartData {
  title: string;
  validation_thought?: string;
  type?: 'bar' | 'line' | 'pie' | 'area';
  unit?: string;
  source?: string;
  colors?: string[];
  description?: string;
  dataKeys?: string[];
  data: any[];
}

export interface TokenUsage {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

export interface SectionAnalysis {
  title: string;
  easyExplanation?: string;
  charts?: ChartData[];
  isLoading?: boolean;
  usage?: TokenUsage;
}

export interface ReportData {
  summary: string[];
  chapters?: string[];
  sections: SectionAnalysis[];
  implications: string;
  fileUri?: string;
  mimeType?: string;
  usage?: TokenUsage; // Usage from the initial analyze request
}

export default function ReportResult({ data }: { data: ReportData }) {
  const [copied, setCopied] = useState(false);

  const handleCopyBlog = async () => {
    const markdownText = `
# 📌 보고서 핵심 한눈에 보기

## 📝 보고서 핵심 요약
${data.summary?.map(s => `- ${s}`).join('\n')}

---
${data.sections?.map(section => `
## 📖 ${section.title}
${fixMarkdownTables(section.easyExplanation || '')}

${section.charts?.length > 0 ? section.charts.map(chart => {
  const keys = chart.dataKeys || ['value'];
  return `
### 📊 ${chart.title} ${chart.unit ? `(단위: ${chart.unit})` : ''}
${chart.data.map(d => {
  const values = keys.map(k => `${k}: ${d[k]}`).join(', ');
  return `- ${d.name}: ${values}`;
}).join('\n')}

> 💡 ${chart.description || '본문 참조'}
> *출처: ${chart.source || '원본 보고서'}*
  `;
}).join('\n') : ''}
---
`).join('\n') || ''}

## 💡 핵심 시사점 및 전망
${data.implications}
    `.trim();

    try {
      // 마크다운을 HTML로 변환 (네이버 블로그 붙여넣기 지원용)
      const htmlText = await marked.parse(markdownText);
      
      // Clipboard API를 사용하여 HTML과 Text를 동시에 클립보드에 복사
      const clipboardItem = new ClipboardItem({
        'text/plain': new Blob([markdownText], { type: 'text/plain' }),
        'text/html': new Blob([htmlText], { type: 'text/html' }),
      });
      await navigator.clipboard.write([clipboardItem]);
    } catch (err) {
      console.warn("Clipboard API failed, falling back to plain text", err);
      // Fallback
      await navigator.clipboard.writeText(markdownText);
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrintPdf = () => {
    window.print();
  };

  const [capturingChartId, setCapturingChartId] = useState<string | null>(null);

  const handleCaptureChart = async (elementId: string) => {
    setCapturingChartId(elementId);
    try {
      const element = document.getElementById(elementId);
      if (!element) return;
      
      const canvas = await html2canvas(element, {
        scale: 2, // 고해상도
        backgroundColor: '#ffffff',
      });
      
      canvas.toBlob(async (blob) => {
        if (blob) {
          try {
            const item = new ClipboardItem({ 'image/png': blob });
            await navigator.clipboard.write([item]);
            alert('차트 이미지가 클립보드에 복사되었습니다! (Ctrl+V로 붙여넣기 가능)');
          } catch (e) {
            // Safari 등 일부 브라우저 호환성 문제 시 다운로드로 대체
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `chart-${elementId}.png`;
            link.click();
            URL.revokeObjectURL(url);
          }
        }
      }, 'image/png');
    } catch (err) {
      console.error(err);
      alert('차트 캡처 중 오류가 발생했습니다.');
    } finally {
      setCapturingChartId(null);
    }
  };

  const renderChart = (chart: ChartData) => {
    const type = chart.type || 'bar';
    const keys = chart.dataKeys || ['value'];
    
    switch (type) {
      case 'line':
        return (
          <LineChart data={chart.data} margin={{ top: 30, right: 10, left: -20, bottom: chart.data.length > 5 ? 30 : 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="name" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} interval={0} angle={chart.data.length > 5 ? -45 : 0} textAnchor={chart.data.length > 5 ? 'end' : 'middle'} height={chart.data.length > 5 ? 60 : 30} />
            <YAxis stroke="#64748b" tick={{ fill: '#64748b' }} axisLine={false} tickLine={false} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
              itemStyle={{ fontWeight: 'bold' }}
              cursor={{ fill: 'rgba(0,0,0,0.05)' }}
            />
            {keys.length > 1 && <Legend verticalAlign="top" height={36} iconType="circle" />}
            {keys.map((key, idx) => {
              const color = chart.colors?.[idx] || COLORS[idx % COLORS.length];
              return (
                <Line key={key} type="monotone" dataKey={key} name={key === 'value' ? '수치' : key} stroke={color} strokeWidth={3} dot={{ r: 4, fill: color, strokeWidth: 2 }} activeDot={{ r: 6 }} isAnimationActive={false} />
              );
            })}
          </LineChart>
        );
      case 'pie':
        const pieKey = keys[0] || 'value';
        return (
          <PieChart margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
            <Tooltip 
              contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
              itemStyle={{ color: '#1e293b', fontWeight: 'bold' }}
            />
            <Pie
              data={chart.data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={80}
              paddingAngle={5}
              dataKey={pieKey}
              nameKey="name"
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              labelLine={false}
              isAnimationActive={false}
            >
              {chart.data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={chart.colors?.[index] || COLORS[index % COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        );
      case 'area':
        return (
          <AreaChart data={chart.data} margin={{ top: 30, right: 10, left: -20, bottom: chart.data.length > 5 ? 30 : 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="name" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} interval={0} angle={chart.data.length > 5 ? -45 : 0} textAnchor={chart.data.length > 5 ? 'end' : 'middle'} height={chart.data.length > 5 ? 60 : 30} />
            <YAxis stroke="#64748b" tick={{ fill: '#64748b' }} axisLine={false} tickLine={false} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
              itemStyle={{ fontWeight: 'bold' }}
              cursor={{ fill: 'rgba(0,0,0,0.05)' }}
            />
            {keys.length > 1 && <Legend verticalAlign="top" height={36} iconType="circle" />}
            {keys.map((key, idx) => {
              const color = chart.colors?.[idx] || COLORS[idx % COLORS.length];
              return (
                <Area key={key} type="monotone" dataKey={key} name={key === 'value' ? '수치' : key} stroke={color} fillOpacity={0.15} fill={color} isAnimationActive={false} />
              );
            })}
          </AreaChart>
        );
      case 'bar':
      default:
        return (
          <BarChart data={chart.data} margin={{ top: 30, right: 10, left: -20, bottom: chart.data.length > 5 ? 30 : 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="name" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} interval={0} angle={chart.data.length > 5 ? -45 : 0} textAnchor={chart.data.length > 5 ? 'end' : 'middle'} height={chart.data.length > 5 ? 60 : 30} />
            <YAxis stroke="#64748b" tick={{ fill: '#64748b' }} axisLine={false} tickLine={false} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
              itemStyle={{ fontWeight: 'bold' }}
              cursor={{ fill: 'rgba(0,0,0,0.05)' }}
            />
            {keys.length > 1 && <Legend verticalAlign="top" height={36} iconType="circle" />}
            {keys.map((key, idx) => {
              const color = chart.colors?.[idx] || COLORS[idx % COLORS.length];
              return (
                <Bar key={key} dataKey={key} name={key === 'value' ? '수치' : key} fill={color} radius={[4, 4, 0, 0]} barSize={keys.length > 1 ? 25 : 45} isAnimationActive={false} minPointSize={3}>
                  {keys.length === 1 && <LabelList dataKey={key} position="top" fill="#475569" fontSize={12} fontWeight={600} />}
                </Bar>
              );
            })}
          </BarChart>
        );
    }
  };

  return (
    <div className={`${styles.container} animate-fade-in`}>
      
      {/* 핵심 요약 */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <CheckCircle2 className={styles.icon} size={28} />
          <h2 className={styles.sectionTitle}>보고서 핵심 요약</h2>
        </div>
        <ul className={styles.summaryList}>
          {data.summary?.map((item, index) => (
            <li key={index} className={styles.summaryItem}>
              <Check className={styles.checkIcon} size={20} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 목차별 상세 분석 */}
      {data.sections?.map((section, idx) => (
        <div key={idx} className={styles.sectionWrapper} style={{ marginBottom: '1.25rem' }}>
          
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <BookOpen className={styles.icon} size={28} />
              <h2 className={styles.sectionTitle}>{section.title}</h2>
            </div>
            
            {section.isLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2rem 0', color: '#64748b' }}>
                <Loader2 className="animate-spin" size={32} style={{ marginBottom: '1rem', animation: 'spin 2s linear infinite' }} />
                <p>해당 챕터를 AI가 분석하고 있습니다...</p>
              </div>
            ) : (
              <>
                <div className={`${styles.textBlock} markdown-content`}>
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]} 
                    rehypePlugins={[rehypeRaw]}
                  >
                    {fixMarkdownTables(section.easyExplanation || '')}
                  </ReactMarkdown>
                </div>

                {/* 해당 섹션의 차트들 (Capture-Friendly Layout + Multi-Series) */}
                {section.charts && section.charts.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                    {section.charts.map((chart, chartIdx) => (
                      <div key={chartIdx} className={styles.chartCard} id={`chart-${idx}-${chartIdx}`}>
                        <div className={styles.chartHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <h3 className={styles.chartTitle}>{chart.title}</h3>
                            {chart.unit && <span className={styles.chartUnit}>단위: {chart.unit}</span>}
                          </div>
                          <button 
                            onClick={() => handleCaptureChart(`chart-${idx}-${chartIdx}`)}
                            className={styles.copyButton}
                            style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', alignSelf: 'flex-start', flexShrink: 0 }}
                            title="차트를 이미지로 복사합니다"
                          >
                            {capturingChartId === `chart-${idx}-${chartIdx}` ? <Loader2 className="animate-spin" size={16} /> : <Camera size={16} />}
                            <span style={{ marginLeft: '4px' }}>캡처</span>
                          </button>
                        </div>
                        
                        <div className={styles.chartContainer}>
                          <ResponsiveContainer width="100%" height="100%">
                            {renderChart(chart)}
                          </ResponsiveContainer>
                        </div>
                        
                        {chart.description && (
                          <div className={styles.chartDescription}>
                            <p style={{ margin: 0, marginBottom: chart.source ? '0.5rem' : 0 }}>💡 {chart.description}</p>
                            {chart.source && (
                              <p style={{ margin: 0, fontSize: '0.9rem', color: '#64748b', textAlign: 'right' }}>
                                출처: {chart.source}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      ))}

      {/* 시사점 */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <FileText className={styles.icon} size={28} />
          <h2 className={styles.sectionTitle}>핵심 시사점 및 전망</h2>
        </div>
        <div className={styles.lifeImpactBox}>
          <div className={`${styles.lifeImpactText} markdown-content`}>
            <ReactMarkdown 
              remarkPlugins={[remarkGfm]} 
              rehypePlugins={[rehypeRaw]}
            >
              {`💡 ` + data.implications}
            </ReactMarkdown>
          </div>
        </div>
      </section>

      {/* 블로그 복사 및 PDF 저장 */}
      <div className={styles.actionContainer}>
        <button onClick={handleCopyBlog} className={styles.copyButton}>
          {copied ? <Check size={20} /> : <Copy size={20} />}
          {copied ? '복사 완료!' : '블로그 양식 복사 (MD)'}
        </button>
        <button onClick={handlePrintPdf} className={styles.pdfButton}>
          <Download size={20} />
          PDF로 깔끔하게 저장하기
        </button>
      </div>

    </div>
  );
}
