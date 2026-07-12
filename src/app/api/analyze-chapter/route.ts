import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

export const maxDuration = 300; // 5분 타임아웃 연장

export async function POST(req: NextRequest) {
  try {
    const { fileUri, mimeType, chapterTitle } = await req.json();

    if (!fileUri || !chapterTitle) {
      return NextResponse.json({ error: 'fileUri and chapterTitle are required' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini API Key is missing.' }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
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
      첨부된 한국은행 또는 공공기관의 경제 리포트(PDF)에서 **"${chapterTitle}"** 챕터 하나만을 집중적으로 심층 분석하세요.

      [분량별 유연한 분석 룰 (매우 중요)]
      당신은 전체 PDF의 페이지 수를 파악한 뒤, 길이에 따라 아래 룰을 엄격히 적용하세요:
      1. **짧은 보고서 (전체 20페이지 이하)**: 타임아웃 위험이 없으므로 'easyExplanation'을 4~5문장 이상으로 상세하고 깊이 있게 설명하세요. 차트 1개당 데이터 포인트도 원한다면 최대 8~10개까지 충분히 추출해도 좋습니다.
      2. **방대한 보고서 (전체 20페이지 초과)**: 시스템 에러(타임아웃)를 막기 위해 'easyExplanation'은 가장 핵심만 2~3문장으로 매우 짧게 요약하세요. 차트 데이터 포인트는 최신 수치 위주로 **절대 최대 5개**를 넘지 않게 제한하세요. 미니 마크다운 표도 무조건 2~3줄만 작게 그리세요.

      분석 지침:
      1. easyExplanation: 위 분량별 룰에 맞춰 해당 챕터의 핵심 내용을 대학생 독자가 이해하기 쉽게 설명하세요.
      2. charts: 해당 챕터에 수치 데이터(표, 그래프)가 있다면 가장 중요한 핵심 지표 위주로 **최대 2개 이내의 차트**를 생성하세요. (데이터 포인트 개수는 분량별 룰을 따를 것)
      
      [데이터 추출 정확도 강제 규칙 - 환각(Hallucination) 및 밀림 완벽 차단]
      **1. [수치 추정 절대 금지]**: 절대 PDF 내의 이미지(그래프, 차트)를 눈으로 보고 수치를 어림짐작(~표시 등)하여 기입하지 마세요. 금융 데이터는 정확성이 생명이므로, 반드시 본문 텍스트나 표(Table)에 '명시적으로 적혀 있는 정확한 수치'만을 사용해야 합니다. 만약 정확한 수치 데이터가 없다면 해당 차트 생성을 아예 건너뛰세요.
      **2. [다중 시리즈]**: 여러 항목을 비교할 경우 'dataKeys' 배열(예: ["주담대", "기타대출"])을 사용하고, 'data' 배열에 각 항목 수치를 묶어서 작성하세요.
      **3. [밀림 방지 룰]**: 표의 빈칸, 음수(-), 결측치는 절대 건너뛰지 말고 0 또는 원본 수치 그대로 기입하여 데이터가 밀리는 현상을 원천 차단하세요.
      
      [차트 타입(type) 결정 규칙]
      - 시계열 데이터: 'line' 또는 'area'
      - 단순 비교: 'bar'
      - 비중/점유율: 'pie'
      
      [응답 형식 - 반드시 지킬 것]
      군더더기 말 없이 오직 \`\`\`json 으로 시작하는 단일 JSON 블록만 반환하세요.

      \`\`\`json
      {
        "title": "${chapterTitle}",
        "easyExplanation": "대학생 독자가 이해하기 쉽게 2~3문장으로 핵심만 설명하세요.",
        "charts": [
          {
            "title": "차트 제목",
            "type": "line",
            "unit": "조원",
            "description": "차트가 보여주는 핵심 의미를 1문장으로 요약하세요.",
            "dataKeys": ["주택담보대출", "기타대출"],
            "data": [
              { "name": "1월", "주택담보대출": 3.0, "기타대출": -1.6 },
              { "name": "2월", "주택담보대출": 4.1, "기타대출": -1.2 }
            ]
          }
        ]
      }
      \`\`\`
    `;

    const result = await model.generateContent([
      prompt,
      {
        fileData: {
          fileUri,
          mimeType
        }
      }
    ]);

    const responseText = result.response.text();
    
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    let jsonStr = '';
    
    if (jsonMatch && jsonMatch[1]) {
      jsonStr = jsonMatch[1].trim();
    } else {
      const bracketMatch = responseText.match(/(\{[\s\S]*\})/);
      if (bracketMatch && bracketMatch[1]) {
        jsonStr = bracketMatch[1].trim();
      } else {
        jsonStr = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      }
    }
    
    try {
      const parsedData = JSON.parse(jsonStr);
      return NextResponse.json(parsedData);
    } catch (parseError) {
      console.error('JSON Parse Error in analyze-chapter:', parseError, 'Raw response:', jsonStr);
      return NextResponse.json({ error: 'AI가 올바른 JSON 형식을 반환하지 못했습니다 (Chapter).' }, { status: 500 });
    }

  } catch (error: any) {
    console.error('API Route Error in analyze-chapter:', error);
    return NextResponse.json({ error: 'Internal Server Error: ' + error.message }, { status: 500 });
  }
}
