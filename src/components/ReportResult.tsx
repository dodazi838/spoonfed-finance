'use client';

import { Check, Copy, CheckCircle2, TrendingUp, BookOpen, FileText } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useState } from 'react';
import styles from './ReportResult.module.css';

export interface ReportData {
  summary: string[];
  easyExplanation: string;
  chartData: { name: string; value: number }[];
  chartTitle: string;
  lifeImpact: string;
}

export default function ReportResult({ data }: { data: ReportData }) {
  const [copied, setCopied] = useState(false);

  const handleCopyBlog = () => {
    const markdown = `
# 📌 이번 주 경제 한눈에: ${data.summary[0]}

## 📝 핵심 3줄 요약
${data.summary.map(s => `- ${s}`).join('\n')}

---

## 📖 쉬운 설명 (대학생 눈높이)
${data.easyExplanation}

---

## 📊 핵심 데이터: ${data.chartTitle}
${data.chartData.map(d => `- ${d.name}: ${d.value}`).join('\n')}

---

## 💡 그래서 내 생활에는 어떤 영향이 있나?
${data.lifeImpact}
    `.trim();

    navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`${styles.container} animate-fade-in`}>
      
      {/* 3줄 요약 */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <CheckCircle2 className={styles.icon} size={28} />
          <h2 className={styles.sectionTitle}>이번 주 핵심 3줄 요약</h2>
        </div>
        <ul className={styles.summaryList}>
          {data.summary.map((item, index) => (
            <li key={index} className={styles.summaryItem}>
              <Check className={styles.checkIcon} size={20} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 쉬운 설명 */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <BookOpen className={styles.icon} size={28} />
          <h2 className={styles.sectionTitle}>쉬운 설명 (대학생 눈높이)</h2>
        </div>
        <div className={styles.textBlock}>
          {data.easyExplanation}
        </div>
      </section>

      {/* 차트 영역 */}
      {data.chartData && data.chartData.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <TrendingUp className={styles.icon} size={28} />
            <h2 className={styles.sectionTitle}>{data.chartTitle || '주요 지표'}</h2>
          </div>
          <div className={styles.chartContainer}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="name" stroke="#94a3b8" tick={{ fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)' }}
                  itemStyle={{ color: '#3b82f6', fontWeight: 'bold' }}
                  cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                />
                <Bar dataKey="value" fill="#3b82f6" radius={[6, 6, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

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

      {/* 블로그 복사 */}
      <div className={styles.actionContainer}>
        <button onClick={handleCopyBlog} className={styles.copyButton}>
          {copied ? <Check size={20} /> : <Copy size={20} />}
          {copied ? '복사 완료!' : '블로그 포스팅 양식 복사하기 (Markdown)'}
        </button>
      </div>

    </div>
  );
}
