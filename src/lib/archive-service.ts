import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { ReportData } from '@/components/ReportResult';

export interface ArchivedReport {
  id: string;
  userId: string;
  fileName: string;
  title: string;
  summary: string[];
  implications: string;
  sections: any[];
  isShortReport: boolean;
  chapterCount: number;
  chartCount: number;
  createdAt: any;
}

const LOCAL_STORAGE_KEY = 'spoonfed_archive_reports';

/**
 * 로컬 브라우저 저장소(localStorage)에서 보고서 목록 가져오기
 */
export function getLocalReports(): ArchivedReport[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.error('Failed to read localStorage archive:', e);
    return [];
  }
}

/**
 * 로컬 브라우저 저장소에 보고서 저장 (최대 30개 안전 보관)
 */
export function saveLocalReport(report: ArchivedReport): void {
  if (typeof window === 'undefined') return;
  try {
    const list = getLocalReports();
    // 중복 제거 후 최신 항목을 맨 앞에 추가
    const filtered = list.filter(r => r.id !== report.id);
    const updated = [report, ...filtered].slice(0, 30);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save to localStorage:', e);
  }
}

/**
 * 로컬 브라우저 저장소에서 보고서 삭제
 */
export function deleteLocalReport(reportId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const list = getLocalReports();
    const updated = list.filter(r => r.id !== reportId);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to delete from localStorage:', e);
  }
}

/**
 * 분석 완료된 보고서를 서고(로컬 + 클라우드 Firestore)에 안전하게 저장
 */
export async function saveReportToArchive(
  userId: string | undefined,
  fileName: string,
  reportData: ReportData,
  isShortReport: boolean = false
): Promise<string> {
  const reportId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const title = fileName.replace(/\.[^/.]+$/, '') || '금융 경제 리포트';

  // 차트 개수 및 챕터 개수 계산
  const sections = reportData.sections || [];
  const chapterCount = sections.length;
  let chartCount = 0;
  sections.forEach((sec: any) => {
    if (sec.charts && Array.isArray(sec.charts)) {
      chartCount += sec.charts.length;
    }
  });

  // Firestore & JSON 직렬화 시 undefined 값을 방지하기 위해 정제
  const cleanSections = sections.map((sec: any) => ({
    title: sec.title || '',
    easyExplanation: sec.easyExplanation || '',
    charts: (sec.charts || []).map((ch: any) => ({
      title: ch.title || '',
      type: ch.type || 'line',
      unit: ch.unit || '',
      source: ch.source || '',
      colors: ch.colors || [],
      dataKeys: ch.dataKeys || [],
      data: ch.data || [],
      description: ch.description || '',
    })),
  }));

  const archivedReport: ArchivedReport = {
    id: reportId,
    userId: userId || 'local_user',
    fileName,
    title,
    summary: reportData.summary || [],
    implications: reportData.implications || '',
    sections: cleanSections,
    isShortReport,
    chapterCount,
    chartCount,
    createdAt: Date.now(),
  };

  // 1. 브라우저 로컬 저장소에 즉각 저장 (오프라인, 비로그인, Firebase 오류와 무관하게 100% 보존)
  saveLocalReport(archivedReport);

  // 2. 구글 로그인 상태이고 Firestore가 연결되어 있으면 클라우드에도 동기화
  if (userId && db) {
    try {
      const reportRef = doc(db, 'users', userId, 'reports', reportId);
      const sanitized = JSON.parse(JSON.stringify({
        ...archivedReport,
        timestamp: Date.now(),
      }));
      sanitized.createdAt = serverTimestamp();
      await setDoc(reportRef, sanitized);
    } catch (firebaseErr) {
      console.warn('Firestore cloud sync skipped/failed, but safely stored in local archive:', firebaseErr);
    }
  }

  return reportId;
}

/**
 * 저장된 서고 보고서 목록을 최신순으로 조회 (로컬 + 클라우드 통합)
 */
export async function getUserReports(userId?: string): Promise<ArchivedReport[]> {
  const localList = getLocalReports();

  if (!userId || !db) {
    return localList;
  }

  try {
    const reportsRef = collection(db, 'users', userId, 'reports');
    let snapshot;
    try {
      const q = query(reportsRef, orderBy('createdAt', 'desc'));
      snapshot = await getDocs(q);
    } catch {
      // index 미생성 등으로 orderBy 실패 시 전체 조회 후 인메모리 정렬
      snapshot = await getDocs(reportsRef);
    }

    const cloudReports: ArchivedReport[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const rawCreatedAt = data.createdAt;
      let timestamp = data.timestamp || Date.now();
      if (rawCreatedAt && typeof rawCreatedAt.toMillis === 'function') {
        timestamp = rawCreatedAt.toMillis();
      }

      cloudReports.push({
        id: docSnap.id,
        userId: data.userId || userId,
        fileName: data.fileName || 'document.pdf',
        title: data.title || data.fileName || '리포트',
        summary: data.summary || [],
        implications: data.implications || '',
        sections: data.sections || [],
        isShortReport: data.isShortReport || false,
        chapterCount: data.chapterCount || (data.sections ? data.sections.length : 0),
        chartCount: data.chartCount || 0,
        createdAt: timestamp,
      });
    });

    // Cloud와 Local 병합 (중복 ID 제거)
    const map = new Map<string, ArchivedReport>();
    cloudReports.forEach(r => map.set(r.id, r));
    localList.forEach(r => {
      if (!map.has(r.id)) {
        map.set(r.id, r);
      }
    });

    return Array.from(map.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch (error) {
    console.warn('Error fetching cloud reports, fallback to local archive:', error);
    return localList;
  }
}

/**
 * 서고 보고서 삭제 (로컬 + 클라우드 동시 삭제)
 */
export async function deleteReportFromArchive(userId: string | undefined, reportId: string): Promise<void> {
  // 로컬 삭제
  deleteLocalReport(reportId);

  // 클라우드 삭제
  if (userId && db) {
    try {
      const reportRef = doc(db, 'users', userId, 'reports', reportId);
      await deleteDoc(reportRef);
    } catch (e) {
      console.warn('Cloud delete failed:', e);
    }
  }
}

/**
 * 로그인 시 로컬에 저장되어 있던 보고서들을 클라우드로 자동 마이그레이션
 */
export async function syncLocalReportsToCloud(userId: string): Promise<void> {
  if (!userId || !db) return;
  const localReports = getLocalReports();
  if (localReports.length === 0) return;

  for (const report of localReports) {
    try {
      const reportRef = doc(db, 'users', userId, 'reports', report.id);
      const sanitized = JSON.parse(JSON.stringify({
        ...report,
        userId,
        timestamp: report.createdAt || Date.now(),
      }));
      sanitized.createdAt = serverTimestamp();
      await setDoc(reportRef, sanitized, { merge: true });
    } catch (e) {
      console.warn(`Failed to sync report ${report.id} to cloud:`, e);
    }
  }
}
