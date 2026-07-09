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
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '리포트 분석 중 오류가 발생했습니다.');
      }

      setReportData(data as ReportData);
    } catch (err: any) {
      setError(err.message || '알 수 없는 오류가 발생했습니다.');
      setFile(null);
    } finally {
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
                <h3 className={styles.uploadText}>AI가 리포트를 분석하고 있어요...</h3>
                <p className={styles.uploadSubtext}>리포트 길이에 따라 10~30초 정도 소요될 수 있습니다.</p>
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
