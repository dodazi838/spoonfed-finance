import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import pdfParse from 'pdf-parse';

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

    const pdfData = await pdfParse(buffer);
    const numPages = pdfData.numpages;
    const isShortReport = numPages <= 10;

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
        maxOutputTokens: isShortReport ? 16384 : 8192,
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    });

    const shortReportPrompt = `
      당신은 '떠먹여주는 금융경제'라는 서비스의 최고 등급 수석 에디터입니다.
      첨부된 리포트는 ${numPages}페이지 분량의 짧은 보고서입니다. 
      아래 JSON 형식에 맞게 리포트 전체를 한 번에 심층 분석하세요.

      [문체 가이드라인]
      - 정중하고 전문적인 '합쇼체'("~습니다") 통일. 평어체나 서론 금지.
      - 전문 용어가 나올 때마다 괄호 안에 대학생도 이해할 쉬운 말로 부연 설명 필수.

      [분석 지침]
      1. summary: 보고서 전체 핵심 요약 (3~5문장)
      2. lifeImpact: 일반 대중의 일상에 미치는 영향 직관적 요약 (2~3문장)
      3. sections: 본문을 3~5개의 논리적 챕터(소주제)로 나누어 배열로 반환하세요.
      
      **[sections 작성 원칙]**
      - title: 섹션의 제목
      - easyExplanation: 해당 섹션의 분석적 요약 및 재구성 내용
        * 보고서 원문 복사 금지. 핵심 논지, 인과관계 중심 재구성.
        * 각 문단은 짧고 밀도 있게 (한 문단 5줄 이내).
        * 소제목(###), 구분선(--- 최대 1회), 핵심 요약 테이블(|항목|내용|) 필수 포함.
        * 중요 키워드는 **볼드체**, 가장 중요한 결론 문장은 <mark>형광펜</mark> 처리(최대 2곳).
        * 핵심 통찰 요약문은 인용구(>)로 분리.
      - charts: 중요한 수치 데이터 추이를 보여주는 트렌드 차트 데이터 (15~20개 데이터 포인트 모두 추출). 정확한 수치 기입. 표의 빈칸/음수 무시 금지. 차트 해설(description)은 원인/배경 및 의미를 설명.

      응답은 오직 JSON으로만 반환하세요.
      {
        "summary": ["요약1", "요약2"],
        "lifeImpact": "영향...",
        "isShortReport": true,
        "sections": [
          {
            "title": "챕터 제목",
            "easyExplanation": "마크다운 본문...",
            "charts": [
              { "title": "차트명", "type": "bar", "unit": "%", "dataKeys": ["항목1"], "data": [...], "description": "해설" }
            ]
          }
        ]
      }
    `;

    const longReportPrompt = `
      당신은 '떠먹여주는 금융경제'라는 서비스의 최고 등급 수석 에디터입니다.
      첨부된 리포트는 ${numPages}페이지 분량의 긴 보고서입니다.
      본문을 읽고 핵심 뼈대만 아래 JSON 형식에 맞게 추출하세요. (차트는 그리지 마세요)

      1. summary: 보고서 전체를 관통하는 핵심 요약(최소 3개~최대 5개 문장)
      2. chapters: 이 보고서의 본문 목차를 1차원 문자열 배열로 추출 (최대 7개)
         - 목차 페이지가 없으면 '대제목' 위주로 스캔하여 핵심 소주제 3~5개를 직접 추출
      3. lifeImpact: 일반 대중의 일상에 미치는 영향 직관적 요약 (2~3문장)
      
      군더더기 없이 오직 JSON만 반환하세요.
      {
        "summary": ["요약1", "요약2"],
        "chapters": ["1. 챕터", "2. 챕터"],
        "lifeImpact": "영향...",
        "isShortReport": false
      }
    `;

    const prompt = isShortReport ? shortReportPrompt : longReportPrompt;


    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const result = await (async () => {
      let retries = 2; // 일일 한도 방전을 막기 위해 재시도 횟수 축소
      let delay = 15000;
      for (let i = 0; i < retries; i++) {
        try {
          return await model.generateContent([
            prompt,
            {
              fileData: {
                fileUri: uploadResult.file.uri,
                mimeType: uploadResult.file.mimeType
              }
            }
          ]);
        } catch (e: any) {
          if ((e.status === 503 || e.status === 429) && i < retries - 1) {
            console.log(`[Retry analyze] API Error ${e.status}. Retrying in ${delay}ms... (Attempt ${i + 1}/${retries})`);
            await sleep(delay);
            continue;
          }
          throw e;
        }
      }
      throw new Error("Unreachable");
    })();

    const responseText = result.response.text();
    const usage = result.response.usageMetadata;
    
    let parsedData;
    try {
      // 1차: 그대로 파싱 시도
      parsedData = JSON.parse(responseText);
    } catch {
      try {
        // 2차: 마크다운 코드블록 제거 후 파싱
        const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
          parsedData = JSON.parse(codeBlockMatch[1].trim());
        } else {
          // 3차: 첫 번째 { 부터 마지막 } 까지 추출
          const firstBrace = responseText.indexOf('{');
          const lastBrace = responseText.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            parsedData = JSON.parse(responseText.substring(firstBrace, lastBrace + 1));
          } else {
            throw new Error('No JSON object found in response');
          }
        }
      } catch (parseError) {
        console.error('JSON Parse Error in analyze:', parseError, 'Raw response:', responseText.substring(0, 500));
        return NextResponse.json({ error: 'AI가 올바른 JSON 형식을 반환하지 못했습니다. 다시 시도해 주세요.' }, { status: 500 });
      }
    }
      
    // Phase 2(챕터 분석)에서 재사용할 수 있도록 file URI 반환 (긴 보고서용)
    parsedData.fileUri = uploadResult.file.uri;
    parsedData.mimeType = uploadResult.file.mimeType;
      
    // 토큰 사용량 함께 반환
    if (usage) {
      parsedData.usage = usage;
    }
      
    return NextResponse.json(parsedData);

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
