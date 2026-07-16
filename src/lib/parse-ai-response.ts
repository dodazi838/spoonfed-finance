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
    // all attempts failed
  }

  return { success: false, error: responseText.substring(0, 500) };
}
