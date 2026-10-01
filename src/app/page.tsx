'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { UploadCloud, FileText, Loader2, AlertCircle, CheckSquare, Square, Sparkles, BookOpen, LogIn, LogOut, BookmarkCheck, Sun, Moon } from 'lucide-react';
import styles from './page.module.css';
import ReportResult, { ReportData, SectionAnalysis, snapshotReportForTrace } from '@/components/ReportResult';
import { useAuth } from '@/lib/auth-context';
import ArchiveDrawer from '@/components/ArchiveDrawer';
import { saveReportToArchive, syncLocalReportsToCloud } from '@/lib/archive-service';
import AnalysisTracePanel from '@/components/AnalysisTracePanel';
import { captureAnalysisCall, saveAnalysisSession, sha256, loadAnalysisSession } from '@/lib/analysis-trace-store';
import { TRACE_SCHEMA_VERSION, type AnalysisSession } from '@/lib/analysis-trace-types';
import { version } from '../../package.json';
import { chaptersInReportOrder } from '@/lib/report-layout';
import { type SourceEvidence, type SourceReview } from '@/lib/source-review';

// ─── 타입 정의 ───
type Step = 'upload' | 'select' | 'analyze';

interface TocData {
  sourceReview?: SourceReview;
  analysisId?: string;
  summary: string[];
  chapters: string[];
  implications: string;
  isShortReport: boolean | string;
  sections?: any[];
  fileUri: string;
  mimeType: string;
  usage?: { totalTokenCount: number };
}

// ─── 헬퍼 함수 ───
function checkIsShortReport(data: TocData | null): boolean {
  return data?.isShortReport === true || data?.isShortReport === 'true';
}

// ─── PDF 페이지 수 빠른 카운트 헬퍼 ───
async function countPdfPages(file: File): Promise<{ numPages: number; method: string }> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const text = new TextDecoder('latin1').decode(bytes);
    
    // 1. /Type /Page 매칭 (/Pages 제외)
    const pageMatches = text.match(/\/Type\s*\/Page\b/g);
    if (pageMatches && pageMatches.length > 0) {
      return { numPages: pageMatches.length, method: 'pdf-page-marker-count' };
    }
    
    // 2. /Count 숫자 검색
    const countMatch = text.match(/\/Count\s+(\d+)/);
    if (countMatch && countMatch[1]) {
      const parsed = parseInt(countMatch[1], 10);
      if (parsed > 0 && parsed < 10000) return { numPages: parsed, method: 'pdf-count-marker' };
    }
  } catch (e) {
    console.warn('PDF 페이지 수 감지 실패, 기본값(15) 사용:', e);
  }
  return { numPages: 15, method: 'fallback-15' };
}

// ─── 청크 분할 업로드 함수 ───
async function uploadPdfInChunks(
  file: File,
  onProgress?: (percent: number, statusText: string) => void
): Promise<{ fileUri: string; mimeType: string; sourceEvidence?: SourceEvidence }> {
  const CHUNK_SIZE = 2.5 * 1024 * 1024; // 2.5MB (Vercel 4.5MB 한도 내 안전한 크기)
  const totalSize = file.size;
  const fileName = file.name;
  const mimeType = file.type || 'application/pdf';

  // 1. 업로드 세션 생성
  onProgress?.(0, '업로드 세션 생성 중...');
  const startRes = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'start' }),
  });

  const startText = await startRes.text();
  let startData;
  try {
    startData = JSON.parse(startText);
  } catch {
    throw new Error(`업로드 세션 오류: ${startText.slice(0, 100)}`);
  }

  if (!startRes.ok || !startData.uploadId) {
    throw new Error(startData.error || '업로드 세션 생성에 실패했습니다.');
  }

  const uploadId = startData.uploadId;
  let offset = 0;
  let chunkIndex = 0;
  const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

  // 2. 청크 순차 전송
  while (offset < totalSize) {
    const end = Math.min(offset + CHUNK_SIZE, totalSize);
    const chunkBlob = file.slice(offset, end);
    const isFinal = end >= totalSize;

    const percent = Math.round(((offset + chunkBlob.size) / totalSize) * 90);
    onProgress?.(percent, `대용량 파일 전송 중 (${chunkIndex + 1}/${totalChunks}단계 - ${percent}%)...`);

    const chunkFormData = new FormData();
    chunkFormData.append('uploadId', uploadId);
    chunkFormData.append('isFinal', String(isFinal));
    chunkFormData.append('fileName', fileName);
    chunkFormData.append('mimeType', mimeType);
    chunkFormData.append('chunk', chunkBlob, fileName);

    const chunkRes = await fetch('/api/upload', {
      method: 'POST',
      body: chunkFormData,
    });

    const chunkText = await chunkRes.text();
    let chunkData;
    try {
      chunkData = JSON.parse(chunkText);
    } catch {
      throw new Error(`청크 전송 오류: ${chunkText.slice(0, 100)}`);
    }

    if (!chunkRes.ok || !chunkData.success) {
      throw new Error(chunkData.error || `청크(${chunkIndex + 1}) 업로드 실패`);
    }

    if (isFinal) {
      onProgress?.(100, '파일 업로드 완료! AI 리포트 분석 준비 중...');
      return {
        fileUri: chunkData.fileUri,
        mimeType: chunkData.mimeType || mimeType,
        sourceEvidence: chunkData.sourceEvidence,
      };
    }

    offset = end;
    chunkIndex++;
  }

  throw new Error('업로드가 완료되지 않았습니다.');
}

export default function Home() {
  const { user, signInWithGoogle, logout } = useAuth();
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [isSavedToArchive, setIsSavedToArchive] = useState(false);
  const [isSavingArchive, setIsSavingArchive] = useState(false);

  const [step, setStep] = useState<Step>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  
  const [tocData, setTocData] = useState<TocData | null>(null);
  const [selectedChapters, setSelectedChapters] = useState<string[]>([]);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const activeTrace = useRef<AnalysisSession | null>(null);
  const sourceEvidence = useRef<SourceEvidence | undefined>(undefined);
  const [activeAnalysisId, setActiveAnalysisId] = useState<string>();
  const [selectedModel] = useState<string>('gemini-3.8-flash');
  const [dailyTokens, setDailyTokens] = useState<number>(0);
  const [isClient, setIsClient] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // localStorage 및 테마 초기화
  useEffect(() => {
    setIsClient(true);
    const savedTheme = localStorage.getItem('spoonfed_theme') as 'dark' | 'light' | null;
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
    }

    const storedStr = localStorage.getItem('spoonfed_daily_tokens');
    const storedDate = localStorage.getItem('spoonfed_token_date');
    const todayStr = new Date().toDateString();
    
    if (storedDate === todayStr && storedStr) {
      setDailyTokens(parseInt(storedStr, 10));
    } else {
      localStorage.setItem('spoonfed_daily_tokens', '0');
      localStorage.setItem('spoonfed_token_date', todayStr);
      setDailyTokens(0);
    }
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('spoonfed_theme', nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  const trackTokens = (newTokens: number) => {
    setDailyTokens(prev => {
      const updated = prev + newTokens;
      localStorage.setItem('spoonfed_daily_tokens', updated.toString());
      return updated;
    });
  };

  // 로그인 시 로컬 서고 클라우드 동기화 및 현재 활성 보고서 동기화
  useEffect(() => {
    if (user?.uid) {
      syncLocalReportsToCloud(user.uid).catch(err => console.warn('Sync local reports failed:', err));
      if (activeTrace.current) void saveAnalysisSession(activeTrace.current, user.uid);
      if (reportData) {
        const currentFileName = file?.name || '금융_경제_리포트.pdf';
        saveReportToArchive(user.uid, currentFileName, reportData, checkIsShortReport(tocData))
          .then(() => setIsSavedToArchive(true))
          .catch(err => console.warn('Sync active report to cloud failed:', err));
      }
    }
  }, [user]);

  // 수동 서고 저장 핸들러
  const handleManualSaveArchive = async () => {
    if (!reportData) return;
    setIsSavingArchive(true);
    try {
      const currentFileName = file?.name || '금융_경제_리포트.pdf';
      await saveReportToArchive(user?.uid, currentFileName, reportData, checkIsShortReport(tocData));
      setIsSavedToArchive(true);
      if (user) {
        alert('✅ 분석 서고에 안전하게 저장되었습니다!');
      } else {
        alert('✅ 브라우저 서고에 저장되었습니다!\n(Google 로그인 시 모든 기기에서 클라우드 서고가 동기화됩니다.)');
      }
    } catch (e: any) {
      console.error('Manual save failed:', e);
      alert('서고 저장 중 오류가 발생했습니다: ' + (e.message || '알 수 없는 오류'));
    } finally {
      setIsSavingArchive(false);
    }
  };

  // ─── 파일 핸들링 ───
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type === 'application/pdf') {
        handleFileSelection(droppedFile);
      } else {
        setError('PDF 파일만 업로드 가능합니다.');
      }
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      if (selectedFile.type === 'application/pdf') {
        handleFileSelection(selectedFile);
      } else {
        setError('PDF 파일만 업로드 가능합니다.');
      }
    }
  };

  const handleFileSelection = async (selectedFile: File) => {
    // 최대 100MB까지 지원
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
    if (selectedFile.size > MAX_FILE_SIZE) {
      setError(`파일 크기가 너무 큽니다 (${(selectedFile.size / 1024 / 1024).toFixed(1)}MB). 최대 100MB까지 업로드 가능합니다.`);
      return;
    }

    setFile(selectedFile);
    setError(null);
    setIsUploading(true);
    setUploadProgressText('PDF 페이지 수 및 파일 검사 중...');
    setReportData(null);
    setTocData(null);
    setSelectedChapters([]);
    setIsSavedToArchive(false);
    sourceEvidence.current = undefined;
    const session: AnalysisSession = {
      schemaVersion: TRACE_SCHEMA_VERSION, analysisId: crypto.randomUUID(), createdAt: new Date().toISOString(),
      ownerId: user?.uid,
      input: { fileName: selectedFile.name, fileSize: selectedFile.size },
      selectedChapters: [], calls: [], clientEvents: [],
    };
    activeTrace.current = session;
    setActiveAnalysisId(session.analysisId);
    
    try {
      // 1. PDF 페이지 수 확인
      const { numPages, method } = await countPdfPages(selectedFile);
      session.input.numPages = numPages;
      session.input.pageCountMethod = method;
      try { session.input.fileSha256 = await sha256(await selectedFile.arrayBuffer()); }
      catch { session.clientEvents.push({ at: new Date().toISOString(), stage: 'fingerprint', message: '파일 해시를 계산하지 못했습니다.' }); }
      await saveAnalysisSession(session, user?.uid);

      // 2. 청크 분할 릴레이 업로드 실행
      const uploaded = await uploadPdfInChunks(selectedFile, (_percent, statusText) => {
        setUploadProgressText(statusText);
      });
      const { fileUri, mimeType } = uploaded;
      if (uploaded.sourceEvidence?.fileSha256 && session.input.fileSha256 && uploaded.sourceEvidence.fileSha256 !== session.input.fileSha256) {
        throw new Error('업로드한 PDF와 추출한 원문이 일치하지 않습니다. 파일을 다시 업로드해 주세요.');
      }
      sourceEvidence.current = uploaded.sourceEvidence;
      session.sourceEvidence = uploaded.sourceEvidence;
      if (uploaded.sourceEvidence?.numPages) {
        session.input.numPages = uploaded.sourceEvidence.numPages;
        session.input.pageCountMethod = 'server-pdf-parser';
      }
      await saveAnalysisSession(session, user?.uid);

      // 3. AI 분석 요청 (/api/analyze)
      setUploadProgressText('보고서의 목차와 주요 내용을 확인하고 있습니다...');
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-analysis-id': session.analysisId },
        body: JSON.stringify({
          fileUri,
          mimeType,
          numPages: session.input.numPages,
          sourceEvidence: uploaded.sourceEvidence,
          modelName: selectedModel,
        }),
      });

      const responseText = await response.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(`서버 응답 오류: ${responseText.slice(0, 100)}`);
      }
      await captureAnalysisCall(session, data.trace, user?.uid);
      if (!data.trace) {
        session.clientEvents.push({ at: new Date().toISOString(), stage: 'analyze', message: `서버가 추적 기록을 반환하지 않았습니다. HTTP ${response.status}` });
        await saveAnalysisSession(session, user?.uid);
      }

      if (!response.ok) {
        throw new Error(data.error || '리포트 요약 중 오류가 발생했습니다.');
      }

      if (data.usage?.totalTokenCount) {
        trackTokens(data.usage.totalTokenCount);
      }

      if (data.isShortReport === true || data.isShortReport === 'true') {
        const initialData: ReportData = {
          analysisId: session.analysisId,
          sourceReview: data.sourceReview,
          summary: data.summary || [],
          implications: data.implications || '',
          sections: data.sections || [],
          usage: data.usage
        };
        setReportData(initialData);
        setStep('analyze');
        Object.assign(session, snapshotReportForTrace(initialData), { displayVersion: version });
        await saveAnalysisSession(session, user?.uid);

        // 서고(로컬 + 클라우드)에 자동 저장
        saveReportToArchive(user?.uid, selectedFile.name, initialData, true)
          .then(() => setIsSavedToArchive(true))
          .catch(err => console.error('Auto-save error:', err));
      } else {
        setTocData(data);
        setStep('select');
        // Retain the summary-stage report even if the user closes before choosing chapters.
        void saveReportToArchive(user?.uid, selectedFile.name, {
          analysisId: session.analysisId, summary: data.summary || [], implications: data.implications || '', sections: [],
          sourceReview: data.sourceReview,
        }, false).catch(() => {});
      }
      
      setIsUploading(false);
    } catch (err: any) {
      session.clientEvents.push({ at: new Date().toISOString(), stage: 'upload-or-analyze', message: '업로드 또는 전체 분석 요청에 실패했습니다.' });
      await saveAnalysisSession(session, user?.uid);
      void saveReportToArchive(user?.uid, selectedFile.name, {
        analysisId: session.analysisId, summary: ['분석을 완료하지 못했습니다. 분석 기록에서 오류를 확인해 주세요.'], implications: '', sections: [],
      }).catch(() => {});
      setError(err.message || '알 수 없는 오류가 발생했습니다.');
      setFile(null);
      setIsUploading(false);
      setStep('upload');
    }
  };

  // ─── 챕터 선택 ───
  const toggleChapterSelection = (chapter: string) => {
    setSelectedChapters(prev => {
      if (prev.includes(chapter)) {
        return prev.filter(c => c !== chapter);
      }
      const limit = checkIsShortReport(tocData) ? 999 : 4;
      if (prev.length >= limit) return prev;
      return [...prev, chapter];
    });
  };

  const handleAnalyzeSelected = async () => {
    if (selectedChapters.length === 0) {
      setError('최소 1개의 챕터를 선택해주세요.');
      return;
    }

    setStep('analyze');
    setError(null);
    const orderedChapters = chaptersInReportOrder(tocData?.chapters || [], selectedChapters);
    const session = activeTrace.current;
    if (session) {
      session.selectedChapters = orderedChapters;
      await saveAnalysisSession(session, user?.uid);
    }

    const initialSections: SectionAnalysis[] = orderedChapters.map((chapterTitle: string) => ({
      title: chapterTitle,
      isLoading: true,
    }));

    const initialData: ReportData = {
      analysisId: tocData?.analysisId || session?.analysisId,
      summary: tocData?.summary || [],
      sourceReview: tocData?.sourceReview,
      implications: tocData?.implications || '',
      sections: initialSections,
      fileUri: tocData?.fileUri,
      mimeType: tocData?.mimeType,
    };

    setReportData(initialData);

    const completedSections = [...initialSections];

    for (let i = 0; i < orderedChapters.length; i++) {
      const chapterTitle = orderedChapters[i];
      
      try {
        const chapterRes = await fetch('/api/analyze-chapter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(session ? { 'x-analysis-id': session.analysisId } : {}) },
          body: JSON.stringify({
            fileUri: tocData?.fileUri,
            mimeType: tocData?.mimeType,
            chapterTitle: chapterTitle,
            sourceEvidence: sourceEvidence.current,
            modelName: selectedModel
          })
        });

        // Vercel 에러 시 안전한 JSON 파싱
        const chapterText = await chapterRes.text();
        let chapterData;
        try {
          chapterData = JSON.parse(chapterText);
        } catch {
          chapterData = { error: `서버 응답 오류: ${chapterText.slice(0, 100)}` };
        }
        if (session) await captureAnalysisCall(session, chapterData.trace, user?.uid);
        if (session && !chapterData.trace) {
          session.clientEvents.push({ at: new Date().toISOString(), stage: 'analyze-chapter', message: `${chapterTitle}: 서버가 추적 기록을 반환하지 않았습니다. HTTP ${chapterRes.status}` });
          await saveAnalysisSession(session, user?.uid);
        }
        
        if (chapterData.usage?.totalTokenCount) {
          trackTokens(chapterData.usage.totalTokenCount);
        }

        if (chapterRes.ok && !chapterData.error) {
          completedSections[i] = {
            title: chapterData.title || chapterTitle,
            easyExplanation: chapterData.easyExplanation,
            charts: chapterData.charts,
            sourceReview: chapterData.sourceReview,
            isLoading: false,
          };
        } else {
          completedSections[i] = {
            title: chapterTitle,
            easyExplanation: chapterData.error || '해당 챕터를 분석하는 중 오류가 발생했습니다.',
            charts: [],
            isLoading: false,
          };
        }

        setReportData(prev => prev ? { ...prev, sections: [...completedSections] } : prev);
      } catch (e: any) {
        if (session) {
          session.clientEvents.push({ at: new Date().toISOString(), stage: 'analyze-chapter', message: `${chapterTitle} 챕터 요청에 실패했습니다.` });
          await saveAnalysisSession(session, user?.uid);
        }
        console.error('Failed to fetch chapter:', e);
        completedSections[i] = {
          title: chapterTitle,
          easyExplanation: e.message || '네트워크 오류가 발생했습니다.',
          charts: [],
          isLoading: false,
        };
        setReportData(prev => prev ? { ...prev, sections: [...completedSections] } : prev);
      }
    }

    // 모든 챕터 분석 완료 후 최종 리포트 데이터 구성 및 서고(로컬 + 클라우드) 자동 저장
    const finalReport: ReportData = {
      analysisId: tocData?.analysisId || session?.analysisId,
      summary: tocData?.summary || [],
      implications: tocData?.implications || '',
      sections: completedSections,
      sourceReview: tocData?.sourceReview,
      fileUri: tocData?.fileUri,
      mimeType: tocData?.mimeType,
    };
    setReportData(finalReport);
    if (session) {
      // Keep a saved feedback note when the in-progress session reference is older.
      const latest = await loadAnalysisSession(session.analysisId, user?.uid);
      session.feedback = latest?.feedback;
      Object.assign(session, snapshotReportForTrace(finalReport), { displayVersion: version });
      await saveAnalysisSession(session, user?.uid);
    }

    const currentFileName = file?.name || '금융_경제_리포트.pdf';
    saveReportToArchive(user?.uid, currentFileName, finalReport, false)
      .then(() => setIsSavedToArchive(true))
      .catch(err => console.error('Auto-save chapters error:', err));
  };

  const resetAll = () => {
    setReportData(null);
    setFile(null);
    setStep('upload');
    activeTrace.current = null;
    setActiveAnalysisId(undefined);
    setTocData(null);
    setSelectedChapters([]);
    setError(null);
    setIsSavedToArchive(false);
  };

  // ─── 렌더링 ───
  const isShort = checkIsShortReport(tocData);
  const chapterLimit = isShort ? 999 : 4;
  
  // 게이지 바 복구: 사용자 요청에 따라 일일 한도(2M) 가시화
  const MAX_DAILY_TOKENS = 2000000; // 2M
  const tokenPercent = Math.min((dailyTokens / MAX_DAILY_TOKENS) * 100, 100);
  const tokenFormatted = (dailyTokens / 1000).toFixed(1) + 'k';
  const tokenColor = dailyTokens > (MAX_DAILY_TOKENS * 0.8) ? '#ef4444' : dailyTokens > (MAX_DAILY_TOKENS * 0.5) ? '#f59e0b' : '#2563eb';

  const handleLogout = () => {
    if (confirm('정말 로그아웃 하시겠습니까?')) {
      logout();
    }
  };

  return (
    <main className={styles.container}>
      
      {/* ─── 상단 글로벌 네비게이션 ─── */}
      <nav className={styles.navbar}>
        <div className={styles.navBrand} onClick={resetAll}>
          <div className={styles.navBrandIconWrapper}>
            <Sparkles size={20} className={styles.navBrandLogo} />
          </div>
          <div className={styles.homeTooltip}>
            <span className={styles.homeTooltipTag}>홈으로 가기</span>
          </div>
          <span className={styles.navBrandText}>SPOONFED FINANCE</span>
        </div>

        <div className={styles.navActions}>
          {/* 테마 전환 버튼 (다크 / 라이트 모드) */}
          <button 
            className={styles.themeToggleBtn} 
            onClick={toggleTheme}
            title={theme === 'dark' ? '라이트 모드로 변경' : '다크 모드로 변경'}
            aria-label="테마 전환"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* 서고 열기 버튼 */}
          <button 
            className={styles.archiveNavBtn}
            onClick={() => setIsArchiveOpen(true)}
            title="저장된 보고서 서고 열기"
          >
            <BookOpen size={16} />
            <span>나의 서고</span>
          </button>

          {/* 로그인 / 프로필 */}
          {user ? (
            <div className={styles.userProfile}>
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || 'User'} className={styles.userAvatar} />
              ) : (
                <div className={styles.userAvatar} style={{ background: '#38bdf8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold' }}>
                  {(user.displayName || user.email || 'U')[0].toUpperCase()}
                </div>
              )}
              <span className={styles.userName}>{user.displayName || user.email?.split('@')[0]}</span>
              <button className={styles.logoutNavBtn} onClick={handleLogout} title="로그아웃">
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <button className={styles.loginNavBtn} onClick={signInWithGoogle}>
              <LogIn size={16} />
              <span>Google 로그인</span>
            </button>
          )}
        </div>
      </nav>
      {step !== 'analyze' && activeAnalysisId && <AnalysisTracePanel analysisId={activeAnalysisId} />}
      
      <section className={`${styles.hero} animate-fade-in`}>
        <div className={styles.badge}>금융·경제 보고서 분석</div>
        <h1 className={styles.title}>
          금융·경제 보고서,<br />
          <span>핵심 내용부터 그 배경까지.</span>
        </h1>
        <p className={styles.description}>
          한국은행·금융감독원 등의 PDF 보고서를 올려 주세요.<br />
          선택한 챕터의 주요 내용과 수치를 풀어 설명하고, 차트로 정리합니다.
        </p>
      </section>

      {step === 'upload' && (
        <section className={`${styles.uploadSection} animate-fade-in animate-delay-2`}>
          
          <div className={styles.modelBadgeContainer}>
            <div className={styles.modelBadge}>
              <strong className={styles.modelBadgeName}>Gemini 3.8 Flash</strong>
              <span className={styles.modelBadgeDesc}>분석에 사용하는 AI 모델</span>
            </div>
          </div>

          <div 
            className={`glass-panel ${styles.dropzone} ${isDragging ? styles.active : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => document.getElementById('fileUpload')?.click()}
          >
            <input 
              type="file" 
              id="fileUpload" 
              className={styles.fileInput} 
              accept="application/pdf"
              onChange={handleFileInput}
            />
            
            {isUploading ? (
              <div className={styles.centeredColumn}>
                <Loader2 className={styles.uploadIcon} style={{ animation: 'spin 2s linear infinite' }} />
                <h3 className={styles.uploadText}>{uploadProgressText || '보고서를 읽고 있습니다...'}</h3>
                <p className={styles.uploadSubtext}>파일을 업로드한 뒤 목차와 주요 내용을 확인합니다.</p>
              </div>
            ) : file ? (
              <div className={styles.centeredColumn}>
                <FileText className={styles.uploadIcon} />
                <h3 className={styles.uploadText}>{file.name}</h3>
                <p className={styles.uploadSubtext}>변경하려면 클릭하거나 새 파일을 드래그하세요</p>
              </div>
            ) : (
              <div className={styles.centeredColumn}>
                <UploadCloud className={styles.uploadIcon} />
                <h3 className={styles.uploadText}>읽어볼 PDF 보고서를 올려 주세요</h3>
                <p className={styles.uploadSubtext}>파일을 드래그하거나 클릭하여 선택하세요 (최대 100MB 지원)</p>
              </div>
            )}
          </div>
          
          {error && (
            <div className={styles.errorBox}>
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}
        </section>
      )}

      {step === 'select' && tocData && (
        <section className={`${styles.selectionSection} animate-fade-in`}>
          <div className={styles.selectionPanel}>
            <h2 className={styles.selectionTitle}>어떤 챕터를 살펴볼까요?</h2>
            
            <div className={styles.summaryBox}>
              <h3 className={styles.summaryTitle}>주요 내용</h3>
              <ul className={styles.summaryList}>
                {tocData.summary?.map((item: string, idx: number) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
              <h3 className={styles.summaryTitle} style={{ marginTop: '1.5rem' }}>앞으로 살펴볼 점</h3>
              <p className={styles.selectionImplications}>{tocData.implications}</p>
            </div>

            <div className={styles.chapterBox}>
              <div className={styles.chapterHeader}>
                <h3 className={styles.chapterTitle}>자세히 읽을 챕터</h3>
                <span className={`${styles.chapterBadge} ${selectedChapters.length === chapterLimit ? styles.chapterBadgeWarning : styles.chapterBadgeActive}`}>
                  {selectedChapters.length} {isShort ? '선택됨' : '/ 4 선택됨'}
                </span>
              </div>
              <p className={styles.chapterDesc}>
                {isShort
                  ? "짧은 보고서는 모든 챕터를 선택할 수 있습니다."
                  : "궁금한 챕터를 최대 4개까지 골라 주세요. 선택한 부분의 내용과 수치를 자세히 정리합니다."}
              </p>
              
              {isShort && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                  <button 
                    onClick={() => {
                      const allChapters = tocData.chapters.map((ch: any) => typeof ch === 'string' ? ch : (ch.title || ch.name || JSON.stringify(ch)));
                      setSelectedChapters(selectedChapters.length === allChapters.length ? [] : allChapters);
                    }}
                    className={styles.selectAllBtn}
                  >
                    {selectedChapters.length === (Array.isArray(tocData.chapters) ? tocData.chapters.length : 0) ? '전체 해제' : '전체 선택하기'}
                  </button>
                </div>
              )}
              
              <div className={styles.chapterList}>
                {Array.isArray(tocData.chapters) ? tocData.chapters.map((ch: any, idx: number) => {
                  const chapter = typeof ch === 'string' ? ch : (ch.title || ch.name || JSON.stringify(ch));
                  const isSelected = selectedChapters.includes(chapter);
                  const isDisabled = !isSelected && selectedChapters.length >= chapterLimit;
                  
                  return (
                    <div 
                      key={idx} 
                      onClick={() => !isDisabled && toggleChapterSelection(chapter)}
                      className={`${styles.chapterItem} ${isSelected ? styles.chapterItemActive : ''} ${isDisabled ? styles.chapterItemDisabled : ''}`}
                    >
                      <div className={isSelected ? styles.chapterCheckActive : styles.chapterCheckInactive}>
                        {isSelected ? <CheckSquare size={24} /> : <Square size={24} />}
                      </div>
                      <span className={`${styles.chapterName} ${isSelected ? styles.chapterNameActive : ''}`}>{chapter}</span>
                    </div>
                  );
                }) : (
                  <p style={{ color: '#fca5a5' }}>목차를 불러오지 못했습니다. 다시 시도해주세요.</p>
                )}
              </div>
            </div>

            {error && (
              <div className={styles.errorBoxInline}>
                <AlertCircle size={20} />
                <span>{error}</span>
              </div>
            )}

            <div className={styles.actionButtons}>
              <button onClick={() => setStep('upload')} className={styles.btnCancel}>
                취소
              </button>
              <button 
                onClick={handleAnalyzeSelected}
                disabled={selectedChapters.length === 0}
                className={styles.btnSubmit}
              >
                {selectedChapters.length > 0 ? `선택한 ${selectedChapters.length}개 챕터 분석 시작` : '분석할 챕터를 선택해주세요'}
              </button>
            </div>
          </div>
        </section>
      )}

      {step === 'analyze' && reportData && (
        <ReportResult 
          data={reportData} 
          onSaveArchive={handleManualSaveArchive}
          isSaved={isSavedToArchive}
          isSaving={isSavingArchive}
        />
      )}
      
      {(step === 'analyze' || step === 'select') && (
        <button onClick={resetAll} className={styles.resetButton}>
          다른 리포트 분석하기
        </button>
      )}

      {/* 서고 슬라이드 드로어 */}
      <ArchiveDrawer
        isOpen={isArchiveOpen}
        onClose={() => setIsArchiveOpen(false)}
        userId={user?.uid}
        onSelectReport={(archivedData, fileName) => {
          activeTrace.current = null;
          setActiveAnalysisId(archivedData.analysisId);
          setFile(new File([], fileName));
          setReportData(archivedData);
          setStep('analyze');
          setIsSavedToArchive(true);
        }}
      />

      {/* 우측 하단 버전 표시 배지 */}
      <div className={styles.versionBadge} title={`SPOONFED FINANCE v${version}`}>
        <span className={styles.versionDot}></span>
        <span>v{version}</span>
      </div>
    </main>
  );
}
