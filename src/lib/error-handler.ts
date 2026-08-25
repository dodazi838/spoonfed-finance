import { NextResponse } from 'next/server';

/**
 * API 라우트 공통 에러 핸들러
 * Gemini API의 503/429 에러에 대해 사용자 친화적 메시지를 반환합니다.
 */
export function handleApiError(error: any, context: string = 'API') {
  console.error(`API Route Error in ${context}:`, error);

  let errorMessage = 'Internal Server Error: ' + (error.message || '알 수 없는 오류');

  if (error.status === 503) {
    errorMessage = '현재 AI 서버에 트래픽이 몰려 지연되고 있습니다. 잠시 후 다시 시도해주세요. (503 Service Unavailable)';
  } else if (error.status === 429) {
    errorMessage = '무료 API 요청 한도를 초과했습니다 (429 Too Many Requests). 약 1분 후 다시 시도하시거나, 모델을 Lite로 변경해 보세요.';
  }

  return NextResponse.json({ error: errorMessage }, { status: 500 });
}

/**
 * Gemini API 호출 with 자동 재시도 (503/429 에러 시)
 */
export async function callWithRetry<T>(
  fn: () => Promise<T>,
  { retries = 2, delay = 15000, context = 'API' }: { retries?: number; delay?: number; context?: string } = {}
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      if ((e.status === 503 || e.status === 429) && i < retries - 1) {
        console.log(`[Retry ${context}] API Error ${e.status}. Retrying in ${delay}ms... (Attempt ${i + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw e;
    }
  }
  throw new Error('Unreachable');
}
