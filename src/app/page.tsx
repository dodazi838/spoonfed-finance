'use client';

import { useState, useCallback } from 'react';
import { UploadCloud, FileText, Loader2, AlertCircle } from 'lucide-react';
import styles from './page.module.css';
import ReportResult, { ReportData } from '@/components/ReportResult';

export default function Home() {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);

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
    
    try {
      // Phase 1: 목차 및 요약 추출
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      });

      const tocData = await response.json();

      if (!response.ok) {
        throw new Error(tocData.error || '리포트 요약 중 오류가 발생했습니다.');
      }

      // Phase 1 결과로 초기 뼈대 UI 설정
      const initialSections = (tocData.chapters || []).map((chapterTitle: string) => ({
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
      setIsUploading(false); // 업로드(Phase 1) 완료 UI 해제. 이후 개별 섹션 렌더링 시작.

      // Phase 2: 순차적으로 각 챕터 분석 (타임아웃 방지 및 안전한 처리)
      for (let i = 0; i < (tocData.chapters || []).length; i++) {
        const chapterTitle = tocData.chapters[i];
        
        try {
          const chapterRes = await fetch('/api/analyze-chapter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileUri: tocData.fileUri,
              mimeType: tocData.mimeType,
              chapterTitle: chapterTitle
            })
          });

          const chapterData = await chapterRes.json();

          if (chapterRes.ok) {
            // 해당 챕터의 로딩 상태 해제 및 데이터 삽입
            setReportData(prev => {
              if (!prev) return prev;
              const newSections = [...prev.sections];
              newSections[i] = {
                title: chapterData.title || chapterTitle,
                easyExplanation: chapterData.easyExplanation,
                charts: chapterData.charts,
                isLoading: false,
              };
              return { ...prev, sections: newSections };
            });
          } else {
            console.error('Chapter fetch error:', chapterData.error);
            // 에러 시 로딩 상태 해제 및 에러 문구 표시
            setReportData(prev => {
              if (!prev) return prev;
              const newSections = [...prev.sections];
              newSections[i] = {
                title: chapterTitle,
                easyExplanation: '해당 챕터를 분석하는 중 오류가 발생했습니다.',
                charts: [],
                isLoading: false,
              };
              return { ...prev, sections: newSections };
            });
          }
        } catch (e) {
          console.error('Failed to fetch chapter:', e);
        }
      }

    } catch (err: any) {
      setError(err.message || '알 수 없는 오류가 발생했습니다.');
      setFile(null);
      setIsUploading(false);
    }
  };

  return (
    <main className={styles.container}>
      <section className={`${styles.hero} animate-fade-in`}>
        <div className={styles.badge}>경제 리포트 번역기</div>
        <h1 className={styles.title}>
          어려운 금융경제,<br />
          <span>대학생 눈높이</span>로 떠먹여 드립니다.
        </h1>
        <p className={styles.description}>
          한국은행, 금융감독원 등 공공기관의 복잡하고 긴 PDF 보고서를 업로드하세요.<br />
          AI가 핵심 내용만 쏙쏙 뽑아 블로그 포스팅 형태로 재가공해 드립니다.
        </p>
      </section>

      {!reportData && (
        <section className={`${styles.uploadSection} animate-fade-in animate-delay-2`}>
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
                <h3 className={styles.uploadText}>리포트 핵심 구조를 파악하고 있어요...</h3>
                <p className={styles.uploadSubtext}>목차 및 요약 추출 중 (약 10초)</p>
              </div>
            ) : file ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <FileText className={styles.uploadIcon} />
                <h3 className={styles.uploadText}>{file.name}</h3>
                <p className={styles.uploadSubtext}>클릭하거나 새 파일을 드래그하여 변경</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <UploadCloud className={styles.uploadIcon} />
                <h3 className={styles.uploadText}>여기로 PDF 리포트를 끌어다 놓으세요</h3>
                <p className={styles.uploadSubtext}>또는 클릭하여 파일 선택 (최대 10MB)</p>
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

      {/* 결과 화면 */}
      {reportData && <ReportResult data={reportData} />}
      
      {/* 다시하기 버튼 */}
      {reportData && (
        <button 
          onClick={() => {
            setReportData(null);
            setFile(null);
          }}
          style={{
            marginTop: '1rem',
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.2)',
            color: 'white',
            padding: '0.75rem 1.5rem',
            borderRadius: '99px',
            cursor: 'pointer',
            transition: 'all 0.3s'
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
