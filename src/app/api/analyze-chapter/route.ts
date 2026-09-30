import { NextRequest, NextResponse } from 'next/server';

import { createModel } from '@/lib/gemini';
import { buildChapterPrompt } from '@/lib/prompt-builder';
import { parseAIResponse } from '@/lib/parse-ai-response';
import { handleApiError, callWithRetry } from '@/lib/error-handler';
import { createAnalysisTrace, finishTrace, setTracePrompt, traceAttempt } from '@/lib/analysis-trace-server';
import { normalizeSourceEvidence, sourceEvidencePrompt, validateSourceReview } from '@/lib/source-review';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const trace = createAnalysisTrace('analyze-chapter', req.headers.get('x-analysis-id'));
  try {
    const { fileUri, mimeType, chapterTitle, modelName, sourceEvidence: rawSource } = await req.json();
    const sourceEvidence = normalizeSourceEvidence(rawSource);
    const selectedModel = modelName || 'gemini-3.8-flash';
    trace.input = { chapterTitle };
    trace.model = { requested: selectedModel, temperature: 0.1, maxOutputTokens: 16384 };

    if (!fileUri || !chapterTitle) {
      return NextResponse.json({ error: 'fileUri and chapterTitle are required', analysisId: trace.analysisId, trace: finishTrace(trace, undefined, new Error('Missing chapter or file')) }, { status: 400 });
    }

    const model = createModel(selectedModel, 16384);
    const prompt = buildChapterPrompt(chapterTitle) + sourceEvidencePrompt(sourceEvidence);
    setTracePrompt(trace, prompt);

    // Gemini API 호출 (선택된 모델로만 3회 자동 재시도)
    const result = await callWithRetry(
      (attempt) => traceAttempt(trace, attempt, () => model.generateContent([
        prompt,
        { fileData: { fileUri, mimeType } },
      ])),
      { retries: 3, initialDelay: 2000, context: 'analyze-chapter' }
    );

    const responseText = result.response.text();
    const usage = result.response.usageMetadata;
    trace.rawResponse = responseText;
    trace.usage = usage;
    trace.finishReason = result.response.candidates?.[0]?.finishReason;
    trace.model.reported = (result.response as unknown as { modelVersion?: string }).modelVersion;

    // JSON 파싱
    const parsed = parseAIResponse(responseText);
    trace.parse = parsed.diagnostics;
    if (trace.finishReason === 'MAX_TOKENS') trace.parse.warnings.push('출력 토큰 한도에 도달했습니다. 응답이 잘렸을 수 있습니다.');
    if (!parsed.success) {
      console.error('JSON Parse Error in analyze-chapter:', trace.requestId, parsed.diagnostics.method);
      // 4차 최후방어: 파싱 실패 시 원문 텍스트를 그대로 보여줌
      trace.transformations.push('JSON 파싱 실패로 AI 원문을 본문에 표시하고 차트를 비웠습니다.');
      const fallback = {
        title: chapterTitle,
        easyExplanation: responseText || 'AI 응답을 파싱하지 못했습니다.',
        charts: [],
        usage,
        analysisId: trace.analysisId,
      };
      return NextResponse.json({ ...fallback, trace: finishTrace(trace, fallback) });
    }

    trace.parsedOutput = JSON.parse(JSON.stringify(parsed.data));
    let easyExplanation = parsed.data.easyExplanation || '';
    if (!easyExplanation.trim() && parsed.data.charts && parsed.data.charts.length > 0) {
      const chartSummaries = parsed.data.charts
        .map((c: any) => `- **${c.title}**: ${c.description || '주요 데이터 추이 분석'}`)
        .join('\n');
      easyExplanation = `> 해당 챕터의 핵심 데이터 및 통계 지표 분석\n\n${chartSummaries}`;
      trace.transformations.push('본문이 비어 있어 차트 설명으로 대체 본문을 생성했습니다.');
    }

    const output = {
      title: parsed.data.title || chapterTitle,
      easyExplanation,
      charts: parsed.data.charts || [],
      sourceReview: validateSourceReview(parsed.data.sourceReview, sourceEvidence),
      usage,
      analysisId: trace.analysisId,
    };
    trace.transformations.push('인용문·수치를 추출된 PDF 텍스트와 대조하고 근거 점검 결과를 추가했습니다.');
    return NextResponse.json({ ...output, trace: finishTrace(trace, output) });

  } catch (e: any) {
    const response = handleApiError(e, 'analyze-chapter');
    const body = await response.json();
    return NextResponse.json({ ...body, analysisId: trace.analysisId, trace: finishTrace(trace, undefined, e) }, { status: response.status });
  }
}
