/**
 * AI 응답에서 JSON을 안전하게 추출하는 3중 폴백 파서
 */
export function parseAIResponse(responseText: string): { success: true; data: any } | { success: false; error: string } {
  // 1차: 그대로 파싱 시도
  try {
    return { success: true, data: JSON.parse(responseText) };
  } catch {
    // continue to fallback
  }

  // 2차: 마크다운 코드블록(```json ... ```) 제거 후 파싱
  try {
    const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return { success: true, data: JSON.parse(codeBlockMatch[1].trim()) };
    }
  } catch {
    // continue to fallback
  }

  // 3차: 첫 번째 { 부터 마지막 } 까지 추출 후 파싱
  try {
    const firstBrace = responseText.indexOf('{');
    const lastBrace = responseText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return { success: true, data: JSON.parse(responseText.substring(firstBrace, lastBrace + 1)) };
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
        data: {
          title: titleMatch ? unescape(titleMatch[1]) : "분석 내용",
          // 끝에 미완성된 표(| 항목 | ...)가 남아있다면 제거 (파싱 실패한 응답이므로 끝에 있는 표는 100% 잘린 표임)
          easyExplanation: (easyExplanationMatch ? unescape(easyExplanationMatch[1]) : responseText)
            .replace(/\|\s*항목\s*\|[\s\S]*$/, '')
            .trim(),
          charts: []
        }
      };
    }
  } catch {
    // continue to fallback
  }

  return { success: false, error: responseText.substring(0, 500) };
}
