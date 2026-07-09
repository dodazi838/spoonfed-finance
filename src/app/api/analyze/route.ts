import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ 
        error: 'Gemini API Key is missing.' 
      }, { status: 500 });
    }

    // 1. 파일을 임시 폴더에 저장합니다. (Next.js Edge Runtime 문제를 우회하기 위해 File API 사용)
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
    const tempDir = os.tmpdir();
    // 안전한 파일명 생성 (한글 등 특수문자 제거)
    const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const tempFilePath = path.join(tempDir, `${Date.now()}_${safeFileName}`);
    await fs.writeFile(tempFilePath, buffer);

    // 2. GoogleAIFileManager를 통해 Gemini 서버로 PDF 파일을 업로드합니다.
    const fileManager = new GoogleAIFileManager(apiKey);
    const genAI = new GoogleGenerativeAI(apiKey);

    const uploadResult = await fileManager.uploadFile(tempFilePath, {
      mimeType: 'application/pdf',
      displayName: file.name,
    });

    // 3. 업로드가 완료되면 임시 파일을 삭제합니다.
    await fs.unlink(tempFilePath).catch(console.error);

    // 4. 업로드된 파일의 URI를 사용하여 Gemini 2.5 Flash에 분석을 요청합니다. (무료 한도 제한 회피)
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
      당신은 '떠먹여주는 금융경제'라는 서비스의 수석 에디터입니다.
      주 독자는 경제/금융 용어에 익숙하지 않은 '대학생'들입니다. 
      첨부된 한국은행 또는 공공기관의 경제 리포트(PDF)를 심도 있게 분석하고, 다음 양식에 맞춰 완벽한 마크다운 형식의 블로그 포스팅용 JSON 데이터를 만들어주세요.

      {
        "summary": ["핵심 요약 문장 1 (최대 30자)", "핵심 요약 문장 2 (최대 30자)", "핵심 요약 문장 3 (최대 30자)"],
        "easyExplanation": "대학생 눈높이에 맞춘 친절하고 쉬운 설명 문단. 경제/금융 용어가 있다면 일상적인 비유를 들어서 설명해주세요. 전체 분량은 3~4문단(500자 내외)으로 구성하세요.",
        "chartData": [
          { "name": "데이터항목1", "value": 100 },
          { "name": "데이터항목2", "value": 80 }
        ],
        "chartTitle": "추출한 데이터를 잘 설명하는 핵심적인 차트 제목 (예: 가계부채 증가율 비교)",
        "lifeImpact": "이 리포트 내용이 대학생의 일상생활(취업, 물가, 학자금 대출 금리, 월세 등)에 어떤 영향을 미치는지 2~3문장으로 설명해주세요."
      }
    `;

    const result = await model.generateContent([
      prompt,
      {
        fileData: {
          fileUri: uploadResult.file.uri,
          mimeType: uploadResult.file.mimeType
        }
      }
    ]);

    const responseText = result.response.text();
    const jsonStr = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    try {
      const parsedData = JSON.parse(jsonStr);
      return NextResponse.json(parsedData);
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError, 'Raw response:', jsonStr);
      return NextResponse.json({ error: 'AI가 올바른 JSON 형식을 반환하지 못했습니다.' }, { status: 500 });
    }

  } catch (error: any) {
    console.error('API Route Error:', error);
    return NextResponse.json({ error: 'Internal Server Error: ' + error.message }, { status: 500 });
  }
}
