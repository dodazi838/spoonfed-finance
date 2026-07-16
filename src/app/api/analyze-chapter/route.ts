import { NextRequest, NextResponse } from 'next/server';

import { createModel } from '@/lib/gemini';
import { buildChapterPrompt } from '@/lib/prompt-builder';
import { parseAIResponse } from '@/lib/parse-ai-response';
import { handleApiError, callWithRetry } from '@/lib/error-handler';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { fileUri, mimeType, chapterTitle, modelName } = await req.json();
    const selectedModel = modelName || 'gemini-2.5-flash';

    if (!fileUri || !chapterTitle) {
      return NextResponse.json({ error: 'fileUri and chapterTitle are required' }, { status: 400 });
    }

    const model = createModel(selectedModel, 16384);
    const prompt = buildChapterPrompt(chapterTitle);

    // Gemini API 호출 (with 재시도)
    const result = await callWithRetry(
      () => model.generateContent([
        prompt,
        { fileData: { fileUri, mimeType } },
      ]),
      { context: 'analyze-chapter' }
    );

    const responseText = result.response.text();
    const usage = result.response.usageMetadata;

    // JSON 파싱
    const parsed = parseAIResponse(responseText);
    if (!parsed.success) {
      console.error('JSON Parse Error in analyze-chapter:', parsed.error);
      // 4차 최후방어: 파싱 실패 시 원문 텍스트를 그대로 보여줌
      return NextResponse.json({
        title: chapterTitle,
        easyExplanation: responseText || 'AI 응답을 파싱하지 못했습니다.',
        charts: [],
        usage,
      });
    }

    return NextResponse.json({
      title: parsed.data.title || chapterTitle,
      easyExplanation: parsed.data.easyExplanation,
      charts: parsed.data.charts || [],
      usage,
    });

  } catch (e: any) {
    return handleApiError(e, 'analyze-chapter');
  }
}
