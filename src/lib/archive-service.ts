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

/**
 * 분석 완료된 보고서를 사용자의 Firestore 서고에 저장
 */
export async function saveReportToArchive(
  userId: string,
  fileName: string,
  reportData: ReportData,
  isShortReport: boolean = false
): Promise<string> {
  if (!db) throw new Error('Firestore가 초기화되지 않았습니다.');

  const reportId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const reportRef = doc(db, 'users', userId, 'reports', reportId);

  // 차트 개수 및 챕터 개수 계산
  const sections = reportData.sections || [];
  const chapterCount = sections.length;
  let chartCount = 0;
  sections.forEach((sec: any) => {
    if (sec.charts && Array.isArray(sec.charts)) {
      chartCount += sec.charts.length;
    }
  });

  const title = fileName.replace(/\.[^/.]+$/, '') || '금융 경제 리포트';

  // Firestore는 undefined 값을 허용하지 않으므로 안전하게 정제
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

  const dataToSave = {
    id: reportId,
    userId,
    fileName,
    title,
    summary: reportData.summary || [],
    implications: reportData.implications || '',
    sections: cleanSections,
    isShortReport,
    chapterCount,
    chartCount,
    createdAt: serverTimestamp(),
    timestamp: Date.now(),
  };

  await setDoc(reportRef, dataToSave);
  return reportId;
}

/**
 * 사용자의 저장된 모든 서고 보고서 목록을 최신순으로 조회
 */
export async function getUserReports(userId: string): Promise<ArchivedReport[]> {
  if (!db) return [];

  try {
    const reportsRef = collection(db, 'users', userId, 'reports');
    const q = query(reportsRef, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);

    const reports: ArchivedReport[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      reports.push({
        id: docSnap.id,
        userId: data.userId,
        fileName: data.fileName || 'document.pdf',
        title: data.title || data.fileName || '리포트',
        summary: data.summary || [],
        implications: data.implications || '',
        sections: data.sections || [],
        isShortReport: data.isShortReport || false,
        chapterCount: data.chapterCount || (data.sections ? data.sections.length : 0),
        chartCount: data.chartCount || 0,
        createdAt: data.timestamp || Date.now(),
      });
    });

    return reports;
  } catch (error) {
    console.error('Error fetching user reports:', error);
    // fallback: order without index if orderBy fails
    try {
      const reportsRef = collection(db, 'users', userId, 'reports');
      const snapshot = await getDocs(reportsRef);
      const reports: ArchivedReport[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        reports.push({
          id: docSnap.id,
          userId: data.userId,
          fileName: data.fileName || 'document.pdf',
          title: data.title || data.fileName || '리포트',
          summary: data.summary || [],
          implications: data.implications || '',
          sections: data.sections || [],
          isShortReport: data.isShortReport || false,
          chapterCount: data.chapterCount || (data.sections ? data.sections.length : 0),
          chartCount: data.chartCount || 0,
          createdAt: data.timestamp || Date.now(),
        });
      });
      return reports.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch (e) {
      console.error('Fallback fetch also failed:', e);
      return [];
    }
  }
}

/**
 * 서고 보고서 삭제
 */
export async function deleteReportFromArchive(userId: string, reportId: string): Promise<void> {
  if (!db) return;
  const reportRef = doc(db, 'users', userId, 'reports', reportId);
  await deleteDoc(reportRef);
}
