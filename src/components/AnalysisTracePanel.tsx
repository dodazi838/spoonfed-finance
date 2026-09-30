'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { loadAnalysisSession, saveAnalysisSession, traceStorageStatus, TRACE_EVENT } from '@/lib/analysis-trace-store';
import type { AnalysisSession } from '@/lib/analysis-trace-types';
import styles from './AnalysisTracePanel.module.css';
import { version } from '../../package.json';

export default function AnalysisTracePanel({ analysisId, result, displayedMarkdown }: {
  analysisId?: string;
  result?: unknown;
  displayedMarkdown?: unknown;
}) {
  const { user } = useAuth();
  const [loadedSession, setSession] = useState<AnalysisSession>();
  const session = loadedSession && loadedSession.analysisId === analysisId && (!loadedSession.ownerId || loadedSession.ownerId === user?.uid) ? loadedSession : undefined;
  const [status, setStatus] = useState('기록 확인 중…');
  const [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState('');
  const loadedFeedback = useRef<string>('');

  useEffect(() => {
    if (!analysisId) return;
    let active = true;
    const refresh = async () => {
      try {
        const loaded = await loadAnalysisSession(analysisId, user?.uid);
        if (!active) return;
        setSession(loaded);
        if (loaded && loadedFeedback.current !== `${analysisId}:${user?.uid || ''}`) {
          loadedFeedback.current = `${analysisId}:${user?.uid || ''}`;
          setFeedback(loaded.feedback || '');
        }
        setStatus(traceStorageStatus(analysisId) || (loaded ? '추적 기록을 불러왔습니다.' : '이 브라우저 또는 계정에 추적 기록이 없습니다.'));
      } catch {
        if (active) setStatus('추적 기록을 불러오지 못했습니다.');
      }
    };
    const onUpdate = (event: Event) => {
      if ((event as CustomEvent<string>).detail === analysisId) void refresh();
    };
    window.addEventListener(TRACE_EVENT, onUpdate);
    void refresh();
    return () => { active = false; window.removeEventListener(TRACE_EVENT, onUpdate); };
  }, [analysisId, user?.uid]);

  if (!analysisId) return null;

  const download = () => {
    if (!session) return;
    const safeResult = result && typeof result === 'object' ? { ...(result as Record<string, unknown>) } : undefined;
    if (safeResult) { delete safeResult.fileUri; delete safeResult.mimeType; }
    const record = { ...session, feedback, exportedAt: new Date().toISOString(), viewedResult: safeResult, viewedMarkdown: displayedMarkdown, viewedAppVersion: version };
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `analysis-${analysisId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const saveFeedback = async () => {
    if (!session) return;
    const latest = await loadAnalysisSession(session.analysisId, user?.uid);
    if (!latest) return;
    await saveAnalysisSession({ ...latest, feedback }, user?.uid);
    setMessage('보완할 점을 기록에 반영했습니다. 저장 상태를 확인해 주세요.');
  };

  return (
    <details className={styles.panel}>
      <summary>분석 기록 <span className={styles.count}>{session?.calls.length || 0}건</span></summary>
      <div className={styles.body}>
        <div className={styles.row}>
          <span>분석 ID</span><code className={styles.id}>{analysisId}</code>
          <button type="button" onClick={async () => {
            try { await navigator.clipboard.writeText(analysisId); setMessage('분석 ID를 복사했습니다.'); }
            catch { setMessage('복사하지 못했습니다. 분석 ID를 직접 선택해 복사해 주세요.'); }
          }}>ID 복사</button>
          <button type="button" disabled={!session} onClick={download}>추적 기록 다운로드</button>
        </div>
        <p className={styles.status} role="status">{status}</p>
        <p className={styles.hint}>문제가 있는 결과는 이 ID와 다운로드한 기록으로 점검할 수 있습니다. 기록에는 보고서 분석 내용이 포함됩니다.</p>
        {session?.calls.map(call => (
          <div className={styles.call} key={call.requestId}>
            <strong>{call.stage === 'analyze' ? '전체 요약·목차 분석' : call.input.chapterTitle || '챕터 분석'}</strong>
            <span>{call.status === 'error' ? '실패' : call.status === 'recovered' ? '보정 후 표시' : '완료'} · {((call.durationMs || 0) / 1000).toFixed(1)}초 · {call.attempts.length}회 호출</span>
            <small>프롬프트 {call.versions.prompt} · 코드 {call.versions.deployment === 'local-unversioned' ? '로컬 버전' : call.versions.deployment.slice(0, 12)}</small>
            {call.parse?.warnings.map((warning, index) => <p className={styles.warning} key={index}>{warning}</p>)}
            {call.transformations.map((change, index) => <p key={index}>{change}</p>)}
          </div>
        ))}
        {!!session?.clientEvents.length && <p className={styles.warning}>업로드 또는 통신 문제 {session.clientEvents.length}건이 기록되었습니다.</p>}
        {session && <div className={styles.feedback}>
          <label htmlFor={`feedback-${analysisId}`}>보완할 점 (선택)</label>
          <textarea id={`feedback-${analysisId}`} value={feedback} placeholder={session.feedback || '예: 12페이지 표의 수치가 차트에서 누락됨. 원문과 동일하게 표시되어야 함.'} onChange={event => setFeedback(event.target.value)} />
          <button type="button" onClick={() => void saveFeedback()}>메모 저장</button>
        </div>}
        {!!message && <p role="status">{message}</p>}
      </div>
    </details>
  );
}
