'use client';
import { findSourceConflicts, type SourceReview } from '@/lib/source-review';
import styles from './SourceReviewPanel.module.css';

export default function SourceReviewPanel({ reviews }: { reviews: { label: string; review?: SourceReview }[] }) {
  const available = reviews.filter(item => item.review);
  const facts = available.flatMap(item => item.review!.facts);
  const matched = facts.filter(f => f.check === 'matched').length;
  const conflicts = findSourceConflicts(available.map(item => item.review));
  const missing = facts.length - matched;
  const partial = available.some(item => item.review!.extractionStatus !== 'available');
  return (
    <details className={styles.panel}>
      <summary>원문 근거 점검 · {available.length ? `인용 일치 ${matched}/${facts.length} · 수치 충돌 ${conflicts.length}건 · 대조 필요 ${missing}건` : '근거 기록 없음'}</summary>
      <div className={styles.body}>
        <p>자동 대조는 기록된 인용문과 숫자가 해당 PDF 페이지에 있는지 확인합니다. 지표의 의미·인과관계·해석의 정확성은 별도 검토가 필요합니다.</p>
        {!available.length && <p className={styles.warning}>이전 분석에는 원문 근거 기록이 없습니다. 같은 PDF를 다시 분석하면 근거 점검이 생성됩니다.</p>}
        {!!available.length && !facts.length && <p className={styles.warning}>AI가 대조할 근거 수치를 반환하지 않았습니다. 원문 대조를 완료하지 못했습니다.</p>}
        {partial && <p className={styles.warning}>PDF 텍스트의 일부 또는 전체를 추출하지 못했습니다. 이미지·표에서만 확인되는 수치는 직접 점검해 주세요.</p>}
        {conflicts.map((group, index) => <div className={styles.warning} key={index}>
          <strong>수치 충돌 · {group[0].metric} ({group[0].period})</strong>
          <p>{group[0].scope} · {group[0].basis}. 어느 값이 맞는지는 원문 확인이 필요합니다.</p>
          <ul>{group.map((fact, i) => <li key={i}>PDF {fact.sourcePage}쪽 · {fact.value?.toLocaleString()} {fact.unit}<blockquote>{fact.quote}</blockquote></li>)}</ul>
        </div>)}
        {available.map(({ label, review }) => <details className={styles.group} key={label}>
          <summary>{label} · 근거 {review!.facts.length}개</summary>
          <ul>{review!.facts.map((fact, index) => <li key={index}>
            <strong>{fact.metric} · {fact.period} · {fact.value === null ? '결측' : fact.value.toLocaleString()} {fact.unit}</strong>
            <p>PDF {fact.sourcePage || '?'}쪽 · {fact.scope} · {fact.basis} · {fact.check === 'matched' ? '인용 일치' : fact.check === 'quote-missing' ? '인용문 대조 필요' : fact.check === 'number-missing' ? '수치 대조 필요' : '텍스트 근거 없음'}</p>
            <blockquote>{fact.quote || '인용문 없음'}</blockquote>
          </li>)}</ul>
          {!!review!.caveats.length && <><h4>AI가 표시한 정의·해석 주의사항</h4><ul>{review!.caveats.map((item, i) => <li key={i}>{item.message} {item.sourcePages.length ? `(PDF ${item.sourcePages.join(', ')}쪽)` : ''}</li>)}</ul></>}
          {!!review!.coverage.length && <><h4>AI 자체 점검 · 반영·누락 목록</h4><p>현재 응답 범위의 자체 점검 목록입니다. 원문 전체의 누락을 독립적으로 검증한 결과는 아닙니다.</p><ul>{review!.coverage.map((item, i) => <li key={i}><strong>{item.status === 'included' ? '포함' : item.status === 'summarized' ? '요약' : '미반영'} · {item.topic}</strong> {item.sourcePages.length ? `(PDF ${item.sourcePages.join(', ')}쪽)` : ''}<p>{item.reason}</p></li>)}</ul></>}
        </details>)}
      </div>
    </details>
  );
}
