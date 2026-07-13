import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

export const maxDuration = 300; // 5분 타임아웃 연장

export async function POST(req: NextRequest) {
  try {
    const { fileUri, mimeType, chapterTitle, modelName } = await req.json();
    const selectedModel = modelName || 'gemini-2.5-flash';

    if (!fileUri || !chapterTitle) {
      return NextResponse.json({ error: 'fileUri and chapterTitle are required' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini API Key is missing.' }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
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
      3. 해설 수준: 원본 보고서의 전문적인 팩트와 수치 데이터가 절대 누락되지 않도록 방대하고 꼼꼼하게 담아내되, 경제/금융 용어에 익숙하지 않은 '대학생' 독자가 읽었을 때 마치 친절한 전공 교수님의 강의를 듣는 것처럼 아주 쉽고 완벽하게 이해될 수 있도록 상세히 풀어서 설명하세요.
      
      첨부된 한국은행 또는 공공기관의 경제 리포트(PDF) 전체 내용 중, 사용자가 핵심적으로 골라낸 **"${chapterTitle}"** 챕터 단 하나만을 집중적으로 초정밀 심층 분석하세요.

      [초정밀 심층 분석 지침 (매우 중요)]
      사용자가 방대한 보고서 중에서 특별히 선택한 가장 중요한 챕터이므로, 대충 요약해서는 안 됩니다.
      1. **easyExplanation**: 위 문체 가이드라인을 엄격히 지키면서, 보고서의 내용(특히 차트와 관련된 분석 내용 포함)이 누락되지 않고 대학생 독자에게 매우 쉽게 전달되도록 아주 상세하고 깊이 있게 (최소 8~10문장 이상) 해설하세요.
         **[중요] 가독성을 위해 글이 한 덩어리로 뭉치지 않도록, 내용의 흐름이 바뀔 때마다 반드시 줄바꿈(\\n\\n)을 사용하여 문단을 3~4개 이상으로 명확히 나누어 작성하세요.**
      2. **charts**: 해당 챕터에 수치 데이터(표, 그래프)가 있다면 가장 중요한 핵심 지표 위주로 차트를 생성하세요. 기존의 '데이터 포인트 5개 제한'은 완전히 폐지되었습니다. **시계열 데이터 등 추이를 보여주는 자료라면 15~20개의 연속된 데이터 포인트라도 모두 추출하여 완벽한 트렌드 차트를 구성하세요.**
      
      [데이터 추출 정확도 강제 규칙 - 환각(Hallucination) 및 밀림 완벽 차단]
      **1. [수치 추정 절대 금지]**: 절대 PDF 내의 이미지(그래프, 차트)를 눈으로 보고 수치를 어림짐작(~표시 등)하여 기입하지 마세요. 금융 데이터는 정확성이 생명이므로, 반드시 본문 텍스트나 표(Table)에 '명시적으로 적혀 있는 정확한 수치'만을 100% 일치하게 사용해야 합니다. 만약 정확한 수치 데이터가 없다면 해당 차트 생성을 아예 건너뛰세요.
      **2. [다중 시리즈]**: 여러 항목을 비교할 경우 'dataKeys' 배열(예: ["주담대", "기타대출"])을 사용하고, 'data' 배열에 각 항목 수치를 묶어서 작성하세요.
      **3. [밀림 방지 룰]**: 표의 빈칸, 음수(-), 결측치는 절대 건너뛰지 말고 0 또는 원본 수치 그대로 기입하여 데이터가 밀리는 현상을 원천 차단하세요.
      
      [차트 타입(type) 결정 규칙]
      - 시계열 데이터: 'line' 또는 'area'
      - 단순 비교: 'bar'
      - 비중/점유율: 'pie'
      
      [응답 형식 - 반드시 지킬 것]
      군더더기 말 없이 오직 순수한 JSON 형식으로만 응답하세요. (앞뒤로 마크다운 코드블록 기호나 백틱을 절대로 붙이지 마세요.)

      {
        "title": "${chapterTitle}",
        "easyExplanation": "대학생 독자가 이해하기 쉽게 상세하게 작성하세요.",
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
    `;

    const result = await model.generateContent([
      prompt,
      {
        fileData: { fileUri, mimeType },
      },
    ]);

    const responseText = result.response.text();
    const usage = result.response.usageMetadata;
    
    let parsedData;
    try {
      // 마크다운 백틱이 혹시라도 섞여 들어왔을 경우 제거
      let cleanJson = responseText.replace(/^[\\s\\S]*?\\{/, '{').replace(/\\}[\\s\\S]*?$/, '}');
      parsedData = JSON.parse(cleanJson);
    } catch (parseError) {
      console.error('JSON Parse Error in analyze-chapter:', parseError, 'Raw response:', responseText);
      return NextResponse.json({ error: 'AI가 올바른 JSON 형식을 반환하지 못했습니다 (Chapter).' }, { status: 500 });
    }

    return NextResponse.json({
      title: parsedData.title || chapterTitle,
      easyExplanation: parsedData.easyExplanation,
      charts: parsedData.charts || [],
      usage
    });

  } catch (e: any) {
    console.error('API Route Error in analyze-chapter:', e);
    let errorMessage = '해당 챕터를 분석하는 중 오류가 발생했습니다.';
    
    if (e.status === 503) {
      errorMessage = '현재 AI 서버에 트래픽이 몰려 지연되고 있습니다. 잠시 후 다시 시도해주세요. (503 Service Unavailable)';
    } else if (e.status === 429) {
      errorMessage = '무료 API 요청 한도를 초과했습니다 (429 Too Many Requests). 약 1분 후 다시 시도하시거나, 모델을 Lite로 변경해 보세요.';
    }
    
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
