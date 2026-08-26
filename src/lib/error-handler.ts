import { NextResponse } from 'next/server';

/**
 * 503 / 429 / 일시적 서버 과부하 에러 여부 판별
 */
export function isTransientError(error: any): boolean {
  if (!error) return false;
  const status = error.status || error.statusCode || error.code;
  const msg = (error.message || '').toLowerCase();

  return (
    status === 503 ||
    status === 429 ||
    status === 500 ||
    msg.includes('503') ||
    msg.includes('service unavailable') ||
    msg.includes('overloaded') ||
    msg.includes('resource_exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('429') ||
    msg.includes('unavailable') ||
    msg.includes('fetch failed') ||
    msg.includes('econnreset')
  );
}

/**
 * API 라우트 공통 에러 핸들러
 */
export function handleApiError(error: any, context: string = 'API') {
  console.error(`API Route Error in ${context}:`, error);

  let errorMessage = '일시적인 분석 오류가 발생했습니다: ' + (error.message || '알 수 없는 오류');

  if (isTransientError(error)) {
    errorMessage = '현재 AI 서버에 트래픽이 몰려 지연되고 있습니다. 잠시 후 다시 시도해주세요. (503 Service Unavailable)';
  }

  return NextResponse.json({ error: errorMessage }, { status: 500 });
}

/**
 * 지수 백오프 기반 스마트 자동 재시도 (단일 모델 유지)
 */
export async function callWithRetry<T>(
  fn: (attempt: number) => Promise<T>,
  {
    retries = 3,
    initialDelay = 2000,
    context = 'API',
  }: { retries?: number; initialDelay?: number; context?: string } = {}
): Promise<T> {
  let lastError: any;

  for (let i = 0; i < retries; i++) {
    try {
      return await fn(i);
    } catch (e: any) {
      lastError = e;
      const isTransient = isTransientError(e);

      if (isTransient && i < retries - 1) {
        // 지수 백오프: 2.0s -> 4.5s -> 9.0s (지터 추가)
        const delay = initialDelay * Math.pow(2, i) + Math.random() * 500;
        console.warn(
          `[Retry ${context}] Transient Error (${e.status || e.message?.slice(0, 50)}). Retrying in ${Math.round(delay)}ms... (Attempt ${i + 1}/${retries})`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw e;
    }
  }

  throw lastError || new Error('All retries failed');
}
