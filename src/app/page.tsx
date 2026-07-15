'use client';

import { useState, useCallback, useEffect } from 'react';
import { UploadCloud, FileText, Loader2, AlertCircle, CheckSquare, Square } from 'lucide-react';
import styles from './page.module.css';
import ReportResult, { ReportData } from '@/components/ReportResult';

type Step = 'upload' | 'select' | 'analyze';

export default function Home() {
  const [step, setStep] = useState<Step>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [tocData, setTocData] = useState<any>(null);
  const [selectedChapters, setSelectedChapters] = useState<string[]>([]);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-flash');
  const [sessionTokens, setSessionTokens] = useState<number>(0);
  const [dailyTokens, setDailyTokens] = useState<number>(0);
  const [isClient, setIsClient] = useState(false);

  // Initialize localStorage on mount
  useEffect(() => {
    setIsClient(true);
    const storedStr = localStorage.getItem('spoonfed_daily_tokens');
    const storedDate = localStorage.getItem('spoonfed_token_date');
    const todayStr = new Date().toDateString(); // Simplified daily reset
    
    if (storedDate === todayStr && storedStr) {
      setDailyTokens(parseInt(storedStr, 10));
    } else {
      localStorage.setItem('spoonfed_daily_tokens', '0');
      localStorage.setItem('spoonfed_token_date', todayStr);
      setDailyTokens(0);
    }
  }, []);

  const trackTokens = (newTokens: number) => {
    setSessionTokens(prev => prev + newTokens);
    setDailyTokens(prev => {
      const updated = prev + newTokens;
      localStorage.setItem('spoonfed_daily_tokens', updated.toString());
      return updated;
    });
  };

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
    setFile(selectedFile);
    setError(null);
    setIsUploading(true);
    setReportData(null);
    setTocData(null);
    setSelectedChapters([]);
    
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('modelName', selectedModel);

      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '리포트 요약 중 오류가 발생했습니다.');
      }

      if (data.usage?.totalTokenCount) {
        trackTokens(data.usage.totalTokenCount);
      }

      if (data.isShortReport === true || data.isShortReport === 'true') {
        // 짧은 보고서는 목차 선택 없이 바로 결과 화면으로 직행
        const initialData: ReportData = {
          summary: data.summary || [],
          lifeImpact: data.lifeImpact || '',
          sections: data.sections || [],
          usage: data.usage
        };
        setReportData(initialData);
        setStep('analyze');
      } else {
        // 긴 보고서는 기존처럼 목차 선택 화면으로 이동
        setTocData(data);
        setStep('select');
      }
      
      setIsUploading(false);
    } catch (err: any) {
      setError(err.message || '알 수 없는 오류가 발생했습니다.');
      setFile(null);
      setIsUploading(false);
      setStep('upload');
    }
  };

  const toggleChapterSelection = (chapter: string) => {
    setSelectedChapters(prev => {
      if (prev.includes(chapter)) {
        return prev.filter(c => c !== chapter);
      }
      const isShort = tocData?.isShortReport === true || tocData?.isShortReport === 'true';
      const limit = isShort ? 999 : 3;
      if (prev.length >= limit) {
        return prev;
      }
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

    const initialSections = selectedChapters.map((chapterTitle: string) => ({
      title: chapterTitle,
      isLoading: true,
    }));

    const initialData: ReportData = {
      summary: tocData.summary || [],
      lifeImpact: tocData.lifeImpact || '',
      sections: initialSections,
      fileUri: tocData.fileUri,
      mimeType: tocData.mimeType,
    };

    setReportData(initialData);

    for (let i = 0; i < selectedChapters.length; i++) {
      const chapterTitle = selectedChapters[i];
      
      try {
        const chapterRes = await fetch('/api/analyze-chapter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileUri: tocData.fileUri,
            mimeType: tocData.mimeType,
            chapterTitle: chapterTitle,
            modelName: selectedModel
          })
        });

        const chapterData = await chapterRes.json();
        
        if (chapterData.usage?.totalTokenCount) {
          trackTokens(chapterData.usage.totalTokenCount);
        }

        setReportData(prev => {
          if (!prev) return prev;
          const newSections = [...prev.sections];
          if (chapterRes.ok) {
            newSections[i] = {
              title: chapterData.title || chapterTitle,
              easyExplanation: chapterData.easyExplanation,
              charts: chapterData.charts,
              isLoading: false,
            };
          } else {
            newSections[i] = {
              title: chapterTitle,
              easyExplanation: chapterData.error || '해당 챕터를 분석하는 중 오류가 발생했습니다.',
              charts: [],
              isLoading: false,
            };
          }
          return { ...prev, sections: newSections };
        });
      } catch (e) {
        console.error('Failed to fetch chapter:', e);
      }
    }
  };

  const resetAll = () => {
    setReportData(null);
    setFile(null);
    setStep('upload');
    setTocData(null);
    setSelectedChapters([]);
    setError(null);
  };

  return (
    <main className={styles.container}>
      
      {/* 글로벌 토큰 위젯 (우측 상단 고정) */}
      {isClient && (
        <div style={{ 
          position: 'fixed', top: '1.5rem', right: '1.5rem', 
          background: 'rgba(255, 255, 255, 0.95)', backdropFilter: 'blur(10px)', 
          border: '1px solid #e2e8f0', padding: '1rem', borderRadius: '12px', 
          zIndex: 100, boxShadow: '0 4px 20px rgba(0,0,0,0.08)', width: '280px' 
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.6rem', alignItems: 'flex-end' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569' }}>일일 무료 한도 (1M)</span>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
              <strong style={{ color: '#2563eb' }}>{(dailyTokens / 1000).toFixed(1)}k</strong> / 1,000k
            </span>
          </div>
          <div style={{ width: '100%', height: '6px', backgroundColor: '#e2e8f0', borderRadius: '99px', overflow: 'hidden' }}>
            <div style={{ 
              width: `${Math.min((dailyTokens / 1000000) * 100, 100)}%`, 
              height: '100%', 
              backgroundColor: dailyTokens > 800000 ? '#ef4444' : dailyTokens > 500000 ? '#f59e0b' : '#2563eb',
              transition: 'width 0.5s ease-out, background-color 0.5s'
            }} />
          </div>
        </div>
      )}

      <section className={`${styles.hero} animate-fade-in`}>
        <div className={styles.badge}>AI 기반 경제 리포트 분석기</div>
        <h1 className={styles.title}>
          복잡한 금융·경제 리포트,<br />
          <span>가장 빠르고 정확하게</span> 분석하세요.
        </h1>
        <p className={styles.description}>
          한국은행, 금융감독원 등 공공기관의 전문 PDF 보고서를 업로드하세요.<br />
          핵심 챕터를 선별하여, 깊이 있는 인사이트와 직관적인 데이터 차트를 도출합니다.
        </p>
      </section>

      {step === 'upload' && (
        <section className={`${styles.uploadSection} animate-fade-in animate-delay-2`}>
          
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ padding: '0.75rem 1.5rem', borderRadius: '12px', border: `2px solid #3b82f6`, background: '#eff6ff' }}>
              <strong style={{ display: 'block', color: '#1e293b', marginBottom: '0.2rem' }}>Gemini 2.5 Flash</strong>
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>최신 AI 모델 적용 중</span>
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
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <Loader2 className={`${styles.uploadIcon} animate-spin`} style={{ animation: 'spin 2s linear infinite' }} />
                <h3 className={styles.uploadText}>리포트 분석 진행 중...</h3>
                <p className={styles.uploadSubtext}>주요 목차 및 핵심 내용 스캔 중 (약 10~20초 소요)</p>
              </div>
            ) : file ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <FileText className={styles.uploadIcon} />
                <h3 className={styles.uploadText}>{file.name}</h3>
                <p className={styles.uploadSubtext}>변경하려면 클릭하거나 새 파일을 드래그하세요</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <UploadCloud className={styles.uploadIcon} />
                <h3 className={styles.uploadText}>PDF 형식의 경제 리포트 업로드</h3>
                <p className={styles.uploadSubtext}>이곳에 파일을 끌어다 놓거나 클릭하여 선택하세요 (최대 10MB)</p>
              </div>
            )}
          </div>
          
          {error && (
            <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '12px', color: '#fca5a5', display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}
        </section>
      )}

      {step === 'select' && tocData && (
        <section className={`${styles.selectionSection} animate-fade-in`}>
          <div className={styles.selectionPanel}>
            <h2 className={styles.selectionTitle}>보고서 요약 및 목차 선택</h2>
            
            <div className={styles.summaryBox}>
              <h3 className={styles.summaryTitle}>📝 핵심 요약</h3>
              <ul className={styles.summaryList}>
                {tocData.summary?.map((item: string, idx: number) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
              <h3 className={styles.summaryTitle} style={{ marginTop: '1.5rem' }}>💡 생활 영향</h3>
              <p style={{ color: '#cbd5e1', lineHeight: '1.7' }}>{tocData.lifeImpact}</p>
            </div>

            <div className={styles.chapterBox}>
              <div className={styles.chapterHeader}>
                <h3 className={styles.chapterTitle}>📖 상세 분석할 챕터 선택</h3>
                <span className={`${styles.chapterBadge} ${selectedChapters.length === (tocData.isShortReport === true || tocData.isShortReport === 'true' ? 999 : 3) ? styles.chapterBadgeWarning : styles.chapterBadgeActive}`}>
                  {selectedChapters.length} {tocData.isShortReport === true || tocData.isShortReport === 'true' ? '선택됨' : '/ 3 선택됨'}
                </span>
              </div>
              <p className={styles.chapterDesc}>
                {tocData.isShortReport === true || tocData.isShortReport === 'true'
                  ? "분량이 짧은 보고서이므로 제한 없이 모든 챕터를 선택하여 상세 분석할 수 있습니다." 
                  : "가장 관심 있는 핵심 챕터를 최대 3개까지만 골라주세요. AI가 선택된 챕터에 한해 심층 분석과 차트를 추출합니다."}
              </p>
              
              {(tocData.isShortReport === true || tocData.isShortReport === 'true') && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                  <button 
                    onClick={() => {
                      const allChapters = tocData.chapters.map((ch: any) => typeof ch === 'string' ? ch : (ch.title || ch.name || JSON.stringify(ch)));
                      if (selectedChapters.length === allChapters.length) {
                        setSelectedChapters([]); // Deselect all
                      } else {
                        setSelectedChapters(allChapters); // Select all
                      }
                    }}
                    style={{ background: 'transparent', border: '1px solid #3b82f6', color: '#38bdf8', padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
                    onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {selectedChapters.length === (Array.isArray(tocData.chapters) ? tocData.chapters.length : 0) ? '전체 해제' : '전체 선택하기'}
                  </button>
                </div>
              )}
              
              <div className={styles.chapterList}>
                {Array.isArray(tocData.chapters) ? tocData.chapters.map((ch: any, idx: number) => {
                  const chapter = typeof ch === 'string' ? ch : (ch.title || ch.name || JSON.stringify(ch));
                  const isSelected = selectedChapters.includes(chapter);
                  const isShort = tocData.isShortReport === true || tocData.isShortReport === 'true';
                  const limit = isShort ? 999 : 3;
                  const isDisabled = !isSelected && selectedChapters.length >= limit;
                  
                  return (
                    <div 
                      key={idx} 
                      onClick={() => !isDisabled && toggleChapterSelection(chapter)}
                      className={`${styles.chapterItem} ${isSelected ? styles.chapterItemActive : ''} ${isDisabled ? styles.chapterItemDisabled : ''}`}
                    >
                      <div style={{ color: isSelected ? '#38bdf8' : '#64748b' }}>
                        {isSelected ? <CheckSquare size={24} /> : <Square size={24} />}
                      </div>
                      <span style={{ color: isSelected ? '#f8fafc' : '#cbd5e1', fontSize: '1rem', fontWeight: isSelected ? '600' : 'normal' }}>{chapter}</span>
                    </div>
                  );
                }) : (
                  <p style={{ color: '#fca5a5' }}>목차를 불러오지 못했습니다. 다시 시도해주세요.</p>
                )}
              </div>
            </div>

            {error && (
              <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '12px', color: '#fca5a5', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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

      {step === 'analyze' && reportData && <ReportResult data={reportData} />}
      
      {(step === 'analyze' || step === 'select') && (
        <button 
          onClick={resetAll}
          style={{
            marginTop: '2rem', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'white', padding: '0.75rem 1.5rem', borderRadius: '99px', cursor: 'pointer', transition: 'all 0.3s', display: 'block', margin: '2rem auto 0 auto'
          }}
          onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
        >
          다른 리포트 분석하기
        </button>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}} />
    </main>
  );
}
