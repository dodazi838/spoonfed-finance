'use client';

import React, { useState, useEffect } from 'react';
import { X, Search, Trash2, BookOpen, BarChart3, Calendar, FileText, Loader2, ArrowRight } from 'lucide-react';
import { ArchivedReport, getUserReports, deleteReportFromArchive } from '@/lib/archive-service';
import { ReportData } from '@/components/ReportResult';
import styles from './ArchiveDrawer.module.css';

interface ArchiveDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string | undefined;
  onSelectReport: (reportData: ReportData, fileName: string, isShort: boolean) => void;
}

export default function ArchiveDrawer({
  isOpen,
  onClose,
  userId,
  onSelectReport,
}: ArchiveDrawerProps) {
  const [reports, setReports] = useState<ArchivedReport[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // 서고 목록 불러오기
  useEffect(() => {
    if (isOpen && userId) {
      loadReports();
    }
  }, [isOpen, userId]);

  const loadReports = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await getUserReports(userId);
      setReports(data);
    } catch (e) {
      console.error('Failed to load archive:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, reportId: string) => {
    e.stopPropagation();
    if (!userId) return;
    if (!confirm('이 보고서를 서고에서 삭제하시겠습니까?')) return;

    setDeletingId(reportId);
    try {
      await deleteReportFromArchive(userId, reportId);
      setReports(prev => prev.filter(r => r.id !== reportId));
    } catch (e) {
      console.error('Failed to delete report:', e);
      alert('삭제 중 오류가 발생했습니다.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenReport = (report: ArchivedReport) => {
    const reportData: ReportData = {
      summary: report.summary || [],
      implications: report.implications || '',
      sections: report.sections || [],
    };
    onSelectReport(reportData, report.fileName, report.isShortReport);
    onClose();
  };

  // 검색 필터링
  const filteredReports = reports.filter(r => {
    const query = searchQuery.toLowerCase();
    const matchTitle = (r.title || '').toLowerCase().includes(query);
    const matchFile = (r.fileName || '').toLowerCase().includes(query);
    const matchSummary = (r.summary || []).some(s => s.toLowerCase().includes(query));
    return matchTitle || matchFile || matchSummary;
  });

  const formatDate = (timestamp: number) => {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.drawer} onClick={e => e.stopPropagation()}>
        
        {/* 헤더 */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <BookOpen className={styles.headerIcon} size={22} />
            <h2 className={styles.title}>나의 분석 서고</h2>
            <span className={styles.badge}>{reports.length}</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="닫기">
            <X size={20} />
          </button>
        </div>

        {/* 검색 바 */}
        <div className={styles.searchContainer}>
          <Search className={styles.searchIcon} size={18} />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="보고서 제목, 요약 키워드 검색..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className={styles.clearSearchBtn} onClick={() => setSearchQuery('')}>
              <X size={14} />
            </button>
          )}
        </div>

        {/* 컨텐츠 목록 */}
        <div className={styles.content}>
          {loading ? (
            <div className={styles.centeredState}>
              <Loader2 className={styles.spinner} size={28} />
              <p>서고 목록을 불러오는 중...</p>
            </div>
          ) : filteredReports.length === 0 ? (
            <div className={styles.centeredState}>
              <FileText size={40} className={styles.emptyIcon} />
              <p className={styles.emptyText}>
                {searchQuery ? '검색 결과가 없습니다.' : '저장된 보고서가 없습니다.'}
              </p>
              <p className={styles.emptySubtext}>
                {searchQuery
                  ? '다른 키워드로 검색해 보세요.'
                  : 'PDF 보고서를 분석하면 서고에 자동으로 영구 보관됩니다.'}
              </p>
            </div>
          ) : (
            <div className={styles.reportList}>
              {filteredReports.map(report => (
                <div
                  key={report.id}
                  className={styles.reportCard}
                  onClick={() => handleOpenReport(report)}
                >
                  <div className={styles.cardHeader}>
                    <h3 className={styles.cardTitle}>{report.title}</h3>
                    <button
                      className={styles.deleteBtn}
                      onClick={e => handleDelete(e, report.id)}
                      disabled={deletingId === report.id}
                      title="서고에서 삭제"
                    >
                      {deletingId === report.id ? (
                        <Loader2 size={16} className={styles.spinner} />
                      ) : (
                        <Trash2 size={16} />
                      )}
                    </button>
                  </div>

                  {/* 메타 뱃지 */}
                  <div className={styles.metaRow}>
                    <span className={styles.metaItem}>
                      <Calendar size={13} />
                      {formatDate(report.createdAt)}
                    </span>
                    <span className={styles.metaItem}>
                      <BookOpen size={13} />
                      {report.chapterCount}개 챕터
                    </span>
                    {report.chartCount > 0 && (
                      <span className={styles.metaItem}>
                        <BarChart3 size={13} />
                        {report.chartCount}개 차트
                      </span>
                    )}
                  </div>

                  {/* 요약 프리뷰 */}
                  {report.summary && report.summary.length > 0 && (
                    <div className={styles.summaryPreview}>
                      <p>{report.summary[0]}</p>
                    </div>
                  )}

                  {/* 열람 액션 */}
                  <div className={styles.cardFooter}>
                    <span className={styles.openHint}>
                      열람하기 <ArrowRight size={14} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
