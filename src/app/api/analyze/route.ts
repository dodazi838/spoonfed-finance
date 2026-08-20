import { NextRequest, NextResponse } from 'next/server';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import pdfParse from 'pdf-parse';

import { createModel, genAI } from '@/lib/gemini';
import { buildShortReportPrompt, buildLongReportPrompt } from '@/lib/prompt-builder';
import { parseAIResponse } from '@/lib/parse-ai-response';
import { handleApiError, callWithRetry } from '@/lib/error-handler';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';

    let fileUri = '';
    let mimeType = 'application/pdf';
    let numPages = 15;
    let selectedModel = 'gemini-3.7-flash';

    // ─── A. 청크 업로드 완료 후 fileUri로 호출된 경우 (대용량 지원) ───
    if (contentType.includes('application/json')) {
      const body = await req.json();
      fileUri = body.fileUri;
      mimeType = body.mimeType || 'application/pdf';
      numPages = body.numPages || 15;
      selectedModel = body.modelName || 'gemini-3.7-flash';

      if (!fileUri) {
        return NextResponse.json({ error: 'fileUri가 누락되었습니다.' }, { status: 400 });
      }
    } 
    // ─── B. 기존 FormData 방식 (하위 호환) ───
    else if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File;
      selectedModel = (formData.get('modelName') as string) || 'gemini-3.7-flash';

      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
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

      const pdfData = await pdfParse(buffer);
      numPages = pdfData.numpages;
      fileUri = uploadResult.file.uri;
      mimeType = uploadResult.file.mimeType;

      await fs.unlink(tempFilePath).catch(console.error);
    } else {
      return NextResponse.json({ error: '지원하지 않는 요청 형식입니다.' }, { status: 400 });
    }

    const isShortReport = numPages <= 10;
    const model = createModel(selectedModel, isShortReport ? 16384 : 8192);
    const prompt = isShortReport
      ? buildShortReportPrompt(numPages)
      : buildLongReportPrompt(numPages);

    // Gemini API 호출 (with 재시도)
    const result = await callWithRetry(
      () => model.generateContent([
        prompt,
        { fileData: { fileUri, mimeType } }
      ]),
      { context: 'analyze' }
    );

    const responseText = result.response.text();
    const usage = result.response.usageMetadata;

    // JSON 파싱
    const parsed = parseAIResponse(responseText);
    if (!parsed.success) {
      console.error('JSON Parse Error in analyze:', parsed.error);
      return NextResponse.json(
        { error: 'AI가 올바른 JSON 형식을 반환하지 못했습니다. 다시 시도해 주세요.' },
        { status: 500 }
      );
    }

    const parsedData = parsed.data;
    
    // 짧은 보고서의 경우 AI가 chapters를 반환하지 않고 sections만 반환하므로, UI 호환성을 위해 chapters를 생성해줍니다.
    if (parsedData.sections && !parsedData.chapters) {
      parsedData.chapters = parsedData.sections.map((s: any) => s.title);
    }
    parsedData.fileUri = fileUri;
    parsedData.mimeType = mimeType;
    if (usage) parsedData.usage = usage;

    return NextResponse.json(parsedData);

  } catch (error: any) {
    return handleApiError(error, 'analyze');
  }
}
