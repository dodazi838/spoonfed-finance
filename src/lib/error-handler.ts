import { NextResponse } from 'next/server';

/**
 * API 라우트 공통 에러 핸들러
 * Gemini API의 503/429 에러에 대해 사용자 친화적 메시지를 반환합니다.
 */
export function handleApiError(error: any, context: string = 'API') {
  console.error(`API Route Error in ${context}:`, error);

  let errorMessage = 'Internal Server Error: ' + (error.message || '알 수 없는 오류');

  if (error.status === 503 || (error.message && error.message.includes('503'))) {
    errorMessage = '현재 구글 AI 서버(Gemini)에 일시적으로 트래픽이 몰려 지연되고 있습니다. 잠시 후 다시 시도해주세요. (503 Service Unavailable)';
  } else if (error.status === 429 || (error.message && error.message.includes('429'))) {
    errorMessage = '무료 API 요청 한도를 초과했습니다 (429 Too Many Requests). 약 1분 후 다시 시도해 주세요.';
  }

  return NextResponse.json({ error: errorMessage }, { status: 500 });
}

/**
 * Gemini API 호출 with 스마트 빠른 재시도 (503/429 에러 시)
 */
export async function callWithRetry<T>(
  fn: (attempt: number) => Promise<T>,
  { retries = 3, initialDelay = 1500, context = 'API' }: { retries?: number; initialDelay?: number; context?: string } = {}
): Promise<T> {
  let lastError: any;

  for (let i = 0; i < retries; i++) {
    try {
      return await fn(i);
    } catch (e: any) {
      lastError = e;
      const errMsg = String(e.message || '');
      const isOverload =
        e.status === 503 ||
        e.status === 429 ||
        errMsg.includes('503') ||
        errMsg.includes('429') ||
        errMsg.includes('overloaded') ||
        errMsg.includes('Resource has been exhausted') ||
        errMsg.includes('Service Unavailable');

      if (isOverload && i < retries - 1) {
        const delay = initialDelay * Math.pow(1.5, i);
        console.log(`[Retry ${context}] AI Server busy (${e.status || errMsg.slice(0, 50)}). Retrying in ${delay}ms... (Attempt ${i + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw e;
    }
  }

  throw lastError || new Error('Unreachable');
}
