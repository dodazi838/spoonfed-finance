import { NextRequest, NextResponse } from 'next/server';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { extractPdfSource } from '@/lib/pdf-source';
import { normalizeSourceEvidence, sourceEvidencePrompt, validateSourceReview } from '@/lib/source-review';

import { createModel } from '@/lib/gemini';
import { buildShortReportPrompt, buildLongReportPrompt } from '@/lib/prompt-builder';
import { parseAIResponse } from '@/lib/parse-ai-response';
import { handleApiError, callWithRetry } from '@/lib/error-handler';
import { createAnalysisTrace, finishTrace, setTracePrompt, traceAttempt } from '@/lib/analysis-trace-server';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const trace = createAnalysisTrace('analyze', req.headers.get('x-analysis-id'));
  try {
    const contentType = req.headers.get('content-type') || '';

    let fileUri = '';
    let mimeType = 'application/pdf';
    let numPages = 15;
    let selectedModel = 'gemini-3.8-flash';
    let sourceEvidence = normalizeSourceEvidence(undefined);

    // ─── A. 청크 업로드 완료 후 fileUri로 호출된 경우 (대용량 지원) ───
    if (contentType.includes('application/json')) {
      const body = await req.json();
      fileUri = body.fileUri;
      mimeType = body.mimeType || 'application/pdf';
      numPages = body.numPages || 15;
      selectedModel = body.modelName || 'gemini-3.8-flash';
      sourceEvidence = normalizeSourceEvidence(body.sourceEvidence);
      if (sourceEvidence.numPages) numPages = sourceEvidence.numPages;
      trace.model.requested = selectedModel;

      if (!fileUri) {
        return NextResponse.json({ error: 'fileUri가 누락되었습니다.', analysisId: trace.analysisId, trace: finishTrace(trace, undefined, new Error('Missing file')) }, { status: 400 });
      }
    } 
    // ─── B. 기존 FormData 방식 (하위 호환) ───
    else if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File;
      selectedModel = (formData.get('modelName') as string) || 'gemini-3.8-flash';
      trace.model.requested = selectedModel;

      if (!file) {
        return NextResponse.json({ error: 'No file provided', analysisId: trace.analysisId, trace: finishTrace(trace, undefined, new Error('Missing file')) }, { status: 400 });
      }

      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      
      const tempDir = os.tmpdir();
      const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const tempFilePath = path.join(tempDir, `${Date.now()}_${safeFileName}`);
      await fs.writeFile(tempFilePath, buffer);

      const apiKey = process.env.GEMINI_API_KEY!;
      const fileManager = new GoogleAIFileManager(apiKey);
      const uploadResult = await fileManager.uploadFile(tempFilePath, {
        mimeType: 'application/pdf',
        displayName: file.name,
      });

      sourceEvidence = await extractPdfSource(buffer);
      numPages = sourceEvidence.numPages || numPages;
      fileUri = uploadResult.file.uri;
      mimeType = uploadResult.file.mimeType;

      await fs.unlink(tempFilePath).catch(console.error);
    } else {
      return NextResponse.json({ error: '지원하지 않는 요청 형식입니다.', analysisId: trace.analysisId, trace: finishTrace(trace, undefined, new Error('Unsupported content type')) }, { status: 400 });
    }

    const isShortReport = numPages <= 10;
    const maxTokens = isShortReport ? 16384 : 8192;
    trace.input = { numPages, mode: isShortReport ? 'short' : 'long' };
    trace.model = { requested: selectedModel, temperature: 0.1, maxOutputTokens: maxTokens };
    const model = createModel(selectedModel, maxTokens);
    const prompt = (isShortReport
      ? buildShortReportPrompt(numPages)
      : buildLongReportPrompt(numPages)) + sourceEvidencePrompt(sourceEvidence);
    setTracePrompt(trace, prompt);

    // Gemini API 호출 (선택된 모델로만 3회 자동 재시도)
    const result = await callWithRetry(
      (attempt) => traceAttempt(trace, attempt, () => model.generateContent([
        prompt,
        { fileData: { fileUri, mimeType } }
      ])),
      { retries: 3, initialDelay: 2000, context: 'analyze' }
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
      console.error('JSON Parse Error in analyze:', trace.requestId, parsed.diagnostics.method);
      return NextResponse.json(
        { error: 'AI가 올바른 JSON 형식을 반환하지 못했습니다. 다시 시도해 주세요.', analysisId: trace.analysisId, trace: finishTrace(trace, undefined, new Error('JSON parse failed')) },
        { status: 500 }
      );
    }

    const parsedData = parsed.data;
    trace.parsedOutput = JSON.parse(JSON.stringify(parsedData));
    parsedData.sourceReview = validateSourceReview(parsedData.sourceReview, sourceEvidence);
    if (Array.isArray(parsedData.sections)) parsedData.sections = parsedData.sections.map((section: any) => ({
      ...section, sourceReview: validateSourceReview(section.sourceReview, sourceEvidence),
    }));
    trace.transformations.push('인용문·수치를 추출된 PDF 텍스트와 대조하고 근거 점검 결과를 추가했습니다.');
    
    // 짧은 보고서의 경우 AI가 chapters를 반환하지 않고 sections만 반환하므로, UI 호환성을 위해 chapters를 생성해줍니다.
    if (parsedData.sections && !parsedData.chapters) {
      parsedData.chapters = parsedData.sections.map((s: any) => s.title);
      trace.transformations.push('sections의 제목으로 UI용 chapters를 생성했습니다.');
    }
    parsedData.fileUri = fileUri;
    parsedData.mimeType = mimeType;
    if (usage) parsedData.usage = usage;
    parsedData.analysisId = trace.analysisId;

    return NextResponse.json({ ...parsedData, trace: finishTrace(trace, parsedData) });

  } catch (error: any) {
    const response = handleApiError(error, 'analyze');
    const body = await response.json();
    return NextResponse.json({ ...body, analysisId: trace.analysisId, trace: finishTrace(trace, undefined, error) }, { status: response.status });
  }
}
