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
    const selectedModel = formData.get('modelName') as string || 'gemini-2.5-flash';

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

    // 4. 업로드된 파일의 URI를 사용하여 Gemini 모델에 분석을 요청합니다.
    const model = genAI.getGenerativeModel({ 
      model: selectedModel,
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
      당신은 '떠먹여주는 금융경제'라는 서비스의 최고 등급 수석 에디터입니다.
      주 독자는 경제/금융 용어에 익숙하지 않은 '대학생'들이지만, 문서의 톤앤매너는 반드시 전문적이고 객관적이어야 합니다.

      [문체 및 작성 가이드라인 - 매우 중요 (어길 시 페널티)]
      1. 종결어미: 모든 문장은 정중하고 전문적인 '합쇼체'("~습니다", "~합니다", "~양상을 보입니다", "~전망입니다")로 철저히 통일하세요. 
      2. 금지사항: "~다", "~함" 같은 딱딱한 평어체나, "안녕하세요", "알아볼까요?" 같은 가벼운 유튜버 말투, 기계적인 번역투는 절대 금지합니다.
      3. 해설 수준: 원본 보고서의 전문적인 팩트와 수치 데이터가 절대 누락되지 않도록 방대하고 꼼꼼하게 담아내되, 경제/금융 용어에 익숙하지 않은 '대학생' 독자가 읽었을 때 마치 친절한 전공 교수님의 강의를 듣는 것처럼 아주 쉽고 완벽하게 이해될 수 있도록 상세히 풀어서 요약/설명하세요.

      첨부된 한국은행 또는 공공기관의 경제 리포트(PDF) 전체 내용을 바탕으로 아래의 JSON 형식에 맞게 리포트의 핵심 구조를 추출하세요. (차트는 그리지 마세요)

      분석 지침:
      1. summary: 보고서 전체를 관통하는 핵심 요약(최소 3개~최대 5개 문장)을 작성하세요.
      2. chapters: 이 보고서의 본문 목차를 반드시 1차원 문자열 배열 형식으로 추출하세요. (최대 7개)
         - 만약 PDF 앞부분에 명시적인 '목차(Table of Contents)' 페이지가 있다면, 적혀있는 텍스트 토씨 하나 틀리지 말고 순서대로 추출하세요.
         - **[중요 예외 처리]** 만약 목차 페이지가 따로 없는 파일이라면, 본문을 훑어보고 글씨 크기가 크거나 진하게 강조된 **'대제목(Section Headers)'** 위주로 스캔하세요. 글 전체의 뼈대가 되는 가장 핵심적인 3~5개의 소주제(섹션 제목)를 직접 찾아내어 목차 형태로 구성해야 합니다. 절대 빈 배열이나 "목차 없음"으로 처리하지 마세요.
         - **[중요]** chapters 배열 안에는 어떠한 객체(Object)도 들어가선 안 되며, 오직 평문 텍스트(String)들만 포함되어야 합니다. (예: ["1. 서론", "2. 본론"])
      3. lifeImpact: 이 리포트 내용이 대학생의 일상생활(물가, 금리 등)에 어떤 영향을 미치는지 2~3문장으로 요약 설명해주세요.
      4. isShortReport: 전체 PDF의 페이지 수를 파악하여, 전체 분량이 15페이지 이하의 짧은 보고서라면 true, 16페이지 이상의 방대한 보고서라면 false를 반환하세요.

      [응답 형식 - 반드시 지킬 것]
      군더더기 말 없이 오직 순수한 JSON 형식으로만 응답하세요. (앞뒤로 마크다운 코드블록 기호나 백틱을 절대로 붙이지 마세요.)

      {
        "summary": ["핵심 요약 문장 1", "핵심 요약 문장 2", "핵심 요약 문장 3"],
        "chapters": [
          "1. 가계 및 기업 신용",
          "2. 금융 및 자산 시장 동향",
          "3. 금융기관 복원력"
        ],
        "lifeImpact": "금리가 오르면 학자금 대출 이자 부담이 커질 수 있습니다...",
        "isShortReport": false
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
    const usage = result.response.usageMetadata;
    
    let parsedData;
    try {
      // 마크다운 백틱이 혹시라도 섞여 들어왔을 경우 제거
      let cleanJson = responseText.replace(/^[\s\S]*?\{/, '{').replace(/\}[\s\S]*?$/, '}');
      parsedData = JSON.parse(cleanJson);
      
      // Phase 2(챕터 분석)에서 재사용할 수 있도록 file URI 반환
      parsedData.fileUri = uploadResult.file.uri;
      parsedData.mimeType = uploadResult.file.mimeType;
      
      // 토큰 사용량 함께 반환
      if (usage) {
        parsedData.usage = usage;
      }
      
      return NextResponse.json(parsedData);
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError, 'Raw response:', responseText);
      return NextResponse.json({ error: 'AI가 올바른 JSON 형식을 반환하지 못했습니다.' }, { status: 500 });
    }

  } catch (error: any) {
    console.error('API Route Error in analyze:', error);
    let errorMessage = 'Internal Server Error: ' + (error.message || '알 수 없는 오류');
    
    if (error.status === 503) {
      errorMessage = '현재 AI 서버에 트래픽이 몰려 지연되고 있습니다. 잠시 후 다시 시도해주세요. (503 Service Unavailable)';
    } else if (error.status === 429) {
      errorMessage = '무료 API 요청 한도를 초과했습니다 (429 Too Many Requests). 약 1분 후 다시 시도하시거나, 모델을 Lite로 변경해 보세요.';
    }
    
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
