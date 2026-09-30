/**
 * AI 응답에서 JSON을 안전하게 추출하는 3중 폴백 파서
 */
import type { ParseDiagnostics, ParseMethod } from './analysis-trace-types';

export function parseAIResponse(responseText: string): ({ success: true; data: any } | { success: false; error: string }) & { diagnostics: ParseDiagnostics } {
  const diagnostics = (method: ParseMethod): ParseDiagnostics => ({
    method, recovered: method !== 'direct',
    warnings: method === 'partial-recovery' ? ['불완전한 응답에서 본문만 복구했습니다. 차트는 복구하지 못했습니다.'] : method === 'failed' ? ['JSON 파싱에 실패했습니다.'] : method !== 'direct' ? ['AI 응답의 JSON 형식을 보정했습니다.'] : [],
  });
  // 1차: 그대로 파싱 시도
  try {
    return { success: true, data: JSON.parse(responseText), diagnostics: diagnostics('direct') };
  } catch {
    // continue to fallback
  }

  // 2차: 마크다운 코드블록(```json ... ```) 제거 후 파싱
  try {
    const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return { success: true, data: JSON.parse(codeBlockMatch[1].trim()), diagnostics: diagnostics('code-block') };
    }
  } catch {
    // continue to fallback
  }

  // 3차: 첫 번째 { 부터 마지막 } 까지 추출 후 파싱
  try {
    const firstBrace = responseText.indexOf('{');
    const lastBrace = responseText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return { success: true, data: JSON.parse(responseText.substring(firstBrace, lastBrace + 1)), diagnostics: diagnostics('brace-extraction') };
    }
  } catch {
    // continue to fallback
  }

  // 4차: 응답이 잘렸거나(Truncated) 파싱 불가능한 경우 정규식으로 강제 추출
  try {
    const titleMatch = responseText.match(/"title"\s*:\s*"([^"]+)"/);
    // easyExplanation 밸류 시작부터 다음 필드(charts) 전까지, 혹은 문자열 끝까지 캡처
    // 끝에 따옴표가 있으면 제거하기 위해 느슨하게 매칭
    const easyExplanationMatch = responseText.match(/"easyExplanation"\s*:\s*"([\s\S]*?)(?:",\s*"charts"|"\s*}|\s*$)/);
    
    if (titleMatch || easyExplanationMatch) {
      // 이스케이프된 문자열(예: \n, \")을 원래 문자로 복원
      const unescape = (str: string) => {
        try {
          return JSON.parse(`"${str}"`);
        } catch {
          return str.replace(/\\n/g, '\n').replace(/\\"/g, '"');
        }
      };

      return {
        success: true,
        diagnostics: diagnostics('partial-recovery'),
        data: {
          title: titleMatch ? unescape(titleMatch[1]) : "분석 내용",
          // 끝에 미완성된 표를 억지로 지우는 정규식 제거 (오히려 정상적인 표까지 모두 날려버리는 부작용 발생)
          easyExplanation: (easyExplanationMatch ? unescape(easyExplanationMatch[1]) : responseText).trim(),
          charts: []
        }
      };
    }
  } catch {
    // continue to fallback
  }

  return { success: false, error: responseText.substring(0, 500), diagnostics: diagnostics('failed') };
}
