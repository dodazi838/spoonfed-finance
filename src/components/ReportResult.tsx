'use client';

import { Check, Copy, CheckCircle2, TrendingUp, BookOpen, FileText, Download, Loader2 } from 'lucide-react';
import { 
  BarChart, Bar, 
  LineChart, Line, 
  PieChart, Pie, Cell,
  AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LabelList, Legend 
} from 'recharts';
import { useState } from 'react';
import styles from './ReportResult.module.css';

// Corporate Light Theme Colors (e.g., Deep Blue, Teal, Amber, Navy, Purple, Rose)
const COLORS = ['#2563eb', '#0f766e', '#f59e0b', '#0369a1', '#6d28d9', '#be123c'];

export interface ChartData {
  title: string;
  validation_thought?: string;
  type?: 'bar' | 'line' | 'pie' | 'area';
  unit?: string;
  description?: string;
  dataKeys?: string[];
  data: any[];
}

export interface SectionAnalysis {
  title: string;
  easyExplanation?: string;
  charts?: ChartData[];
  isLoading?: boolean;
}

export interface ReportData {
  summary: string[];
  chapters?: string[];
  sections: SectionAnalysis[];
  lifeImpact: string;
  fileUri?: string;
  mimeType?: string;
}

export default function ReportResult({ data }: { data: ReportData }) {
  const [copied, setCopied] = useState(false);

  const handleCopyBlog = () => {
    const markdown = `
# 📌 보고서 핵심 한눈에 보기

## 📝 보고서 핵심 요약
${data.summary?.map(s => `- ${s}`).join('\n')}

---
${data.sections?.map(section => `
## 📖 ${section.title}
${section.easyExplanation}

${section.charts?.length > 0 ? section.charts.map(chart => {
  const keys = chart.dataKeys || ['value'];
  return `
### 📊 ${chart.title} ${chart.unit ? `(단위: ${chart.unit})` : ''}
${chart.data.map(d => {
  const values = keys.map(k => `${k}: ${d[k]}`).join(', ');
  return `- ${d.name}: ${values}`;
}).join('\n')}

> 💡 **해설**: ${chart.description || '본문 참조'}
  `;
}).join('\n') : ''}
---
`).join('\n') || ''}

## 💡 그래서 내 생활에는 어떤 영향이 있나?
${data.lifeImpact}
    `.trim();

    navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrintPdf = () => {
    window.print();
  };

  const renderChart = (chart: ChartData) => {
    const type = chart.type || 'bar';
    const keys = chart.dataKeys || ['value'];
    
    switch (type) {
      case 'line':
        return (
          <LineChart data={chart.data} margin={{ top: 30, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="name" stroke="#64748b" tick={{ fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis stroke="#64748b" tick={{ fill: '#64748b' }} axisLine={false} tickLine={false} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
              itemStyle={{ fontWeight: 'bold' }}
              cursor={{ fill: 'rgba(0,0,0,0.05)' }}
            />
            {keys.length > 1 && <Legend verticalAlign="top" height={36} iconType="circle" />}
            {keys.map((key, idx) => {
              const color = COLORS[idx % COLORS.length];
              return (
                <Line key={key} type="monotone" dataKey={key} name={key === 'value' ? '수치' : key} stroke={color} strokeWidth={3} dot={{ r: 4, fill: color, strokeWidth: 2 }} activeDot={{ r: 6 }}>
                  <LabelList dataKey={key} position="top" fill="#1e293b" fontSize={13} fontWeight="bold" offset={10} />
                </Line>
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
            >
              {chart.data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        );
      case 'area':
        return (
          <AreaChart data={chart.data} margin={{ top: 30, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="name" stroke="#64748b" tick={{ fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis stroke="#64748b" tick={{ fill: '#64748b' }} axisLine={false} tickLine={false} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
              itemStyle={{ fontWeight: 'bold' }}
              cursor={{ fill: 'rgba(0,0,0,0.05)' }}
            />
            {keys.length > 1 && <Legend verticalAlign="top" height={36} iconType="circle" />}
            {keys.map((key, idx) => {
              const color = COLORS[idx % COLORS.length];
              return (
                <Area key={key} type="monotone" dataKey={key} name={key === 'value' ? '수치' : key} stroke={color} fillOpacity={0.15} fill={color}>
                   <LabelList dataKey={key} position="top" fill="#1e293b" fontSize={13} fontWeight="bold" offset={10} />
                </Area>
              );
            })}
          </AreaChart>
        );
      case 'bar':
      default:
        return (
          <BarChart data={chart.data} margin={{ top: 30, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="name" stroke="#64748b" tick={{ fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis stroke="#64748b" tick={{ fill: '#64748b' }} axisLine={false} tickLine={false} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
              itemStyle={{ fontWeight: 'bold' }}
              cursor={{ fill: 'rgba(0,0,0,0.05)' }}
            />
            {keys.length > 1 && <Legend verticalAlign="top" height={36} iconType="circle" />}
            {keys.map((key, idx) => {
              const color = COLORS[idx % COLORS.length];
              return (
                <Bar key={key} dataKey={key} name={key === 'value' ? '수치' : key} fill={color} radius={[4, 4, 0, 0]} barSize={keys.length > 1 ? 25 : 45}>
                  <LabelList dataKey={key} position="top" fill="#1e293b" fontSize={13} fontWeight="bold" offset={10} />
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
        <div key={idx} className={styles.sectionWrapper} style={{ marginBottom: '2.5rem' }}>
          
          <section className={styles.section} style={{ marginBottom: '1.5rem' }}>
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
                <div className={styles.textBlock}>
                  {section.easyExplanation}
                </div>

                {/* 해당 섹션의 차트들 (Capture-Friendly Layout + Multi-Series) */}
                {section.charts && section.charts.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1.5rem' }}>
                    {section.charts.map((chart, chartIdx) => (
                      <div key={chartIdx} className={styles.chartCard}>
                        <div className={styles.chartHeader}>
                          <h3 className={styles.chartTitle}>{chart.title}</h3>
                          {chart.unit && <span className={styles.chartUnit}>단위: {chart.unit}</span>}
                        </div>
                        
                        <div className={styles.chartContainer}>
                          <ResponsiveContainer width="100%" height="100%">
                            {renderChart(chart)}
                          </ResponsiveContainer>
                        </div>
                        
                        {chart.description && (
                          <div className={styles.chartDescription}>
                            <strong>💡 해설:</strong> {chart.description}
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

      {/* 생활 영향 */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <FileText className={styles.icon} size={28} />
          <h2 className={styles.sectionTitle}>그래서 내 생활에는 어떤 영향이 있나?</h2>
        </div>
        <div className={styles.lifeImpactBox}>
          <p className={styles.lifeImpactText}>
            💡 {data.lifeImpact}
          </p>
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
