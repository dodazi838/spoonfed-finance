import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export const maxDuration = 300; // 5분으로 타임아웃 연장

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

    // 4. 업로드된 파일의 URI를 사용하여 Gemini 2.5 Flash Lite에 분석을 요청합니다. (일일 무료 한도가 가장 높은 모델)
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE }
      ],
      generationConfig: { 
        maxOutputTokens: 8192,
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    });

    const prompt = `
      당신은 '떠먹여주는 금융경제'라는 서비스의 수석 에디터입니다.
      주 독자는 경제/금융 용어에 익숙하지 않은 '대학생'들입니다. 
      첨부된 한국은행 또는 공공기관의 경제 리포트(PDF)를 분석하여, 다음 JSON 스키마에 맞게 **핵심 요약과 목차만** 추출해주세요. (차트는 그리지 마세요)

      분석 지침:
      1. summary: 보고서 전체를 관통하는 핵심 요약(최소 3개~최대 5개 문장)을 작성하세요.
      2. chapters: 보고서에서 가장 핵심이 되는 주요 거시 경제 챕터 최대 4~5개의 **제목만** 선별하여 배열로 추출하세요.
      3. lifeImpact: 이 리포트 내용이 대학생의 일상생활(물가, 금리 등)에 어떤 영향을 미치는지 2~3문장으로 요약 설명해주세요.

      [응답 형식 - 반드시 지킬 것]
      군더더기 말 없이 오직 \`\`\`json 으로 시작하는 단일 JSON 블록만 반환하세요.

      \`\`\`json
      {
        "summary": ["핵심 요약 문장 1", "핵심 요약 문장 2", "핵심 요약 문장 3"],
        "chapters": [
          "1. 가계 및 기업 신용",
          "2. 금융 및 자산 시장 동향",
          "3. 금융기관 복원력"
        ],
        "lifeImpact": "금리가 오르면 학자금 대출 이자 부담이 커질 수 있습니다..."
      }
      \`\`\`
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
    
    // 정규식을 사용하여 ```json 과 ``` 사이의 텍스트만 안전하게 추출
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    let jsonStr = '';
    
    if (jsonMatch && jsonMatch[1]) {
      jsonStr = jsonMatch[1].trim();
    } else {
      // json 코드 블록이 없는 경우 중괄호 {} 사이의 텍스트 추출 시도
      const bracketMatch = responseText.match(/(\{[\s\S]*\})/);
      if (bracketMatch && bracketMatch[1]) {
        jsonStr = bracketMatch[1].trim();
      } else {
        jsonStr = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      }
    }
    
    try {
      const parsedData = JSON.parse(jsonStr);
      // Phase 2(챕터 분석)에서 재사용할 수 있도록 file URI 반환
      parsedData.fileUri = uploadResult.file.uri;
      parsedData.mimeType = uploadResult.file.mimeType;
      
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
