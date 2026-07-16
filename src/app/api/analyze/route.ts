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
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const selectedModel = formData.get('modelName') as string || 'gemini-2.5-flash';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // 1. 파일을 임시 폴더에 저장
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
    const tempDir = os.tmpdir();
    const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const tempFilePath = path.join(tempDir, `${Date.now()}_${safeFileName}`);
    await fs.writeFile(tempFilePath, buffer);

    // 2. Gemini 서버로 PDF 업로드
    const apiKey = process.env.GEMINI_API_KEY!;
    const fileManager = new GoogleAIFileManager(apiKey);
    const uploadResult = await fileManager.uploadFile(tempFilePath, {
      mimeType: 'application/pdf',
      displayName: file.name,
    });

    // 3. 페이지 수 판별 (파일 삭제 전에 수행)
    const pdfData = await pdfParse(buffer);
    const numPages = pdfData.numpages;
    const isShortReport = numPages <= 10;

    // 4. 임시 파일 삭제
    await fs.unlink(tempFilePath).catch(console.error);

    const model = createModel(selectedModel, isShortReport ? 16384 : 8192);
    const prompt = isShortReport
      ? buildShortReportPrompt(numPages)
      : buildLongReportPrompt(numPages);

    // 5. Gemini API 호출 (with 재시도)
    const result = await callWithRetry(
      () => model.generateContent([
        prompt,
        { fileData: { fileUri: uploadResult.file.uri, mimeType: uploadResult.file.mimeType } }
      ]),
      { context: 'analyze' }
    );

    const responseText = result.response.text();
    const usage = result.response.usageMetadata;

    // 6. JSON 파싱
    const parsed = parseAIResponse(responseText);
    if (!parsed.success) {
      console.error('JSON Parse Error in analyze:', parsed.error);
      return NextResponse.json(
        { error: 'AI가 올바른 JSON 형식을 반환하지 못했습니다. 다시 시도해 주세요.' },
        { status: 500 }
      );
    }

    const parsedData = parsed.data;
    parsedData.fileUri = uploadResult.file.uri;
    parsedData.mimeType = uploadResult.file.mimeType;
    if (usage) parsedData.usage = usage;

    return NextResponse.json(parsedData);

  } catch (error: any) {
    return handleApiError(error, 'analyze');
  }
}
