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
      2. 금지사항 1 (말투): "~다", "~함" 같은 딱딱한 평어체나, "안녕하세요", "알아볼까요?" 같은 가벼운 유튜버 말투, 기계적인 번역투는 절대 금지합니다.
      3. 금지사항 2 (서론 금지): "독자 여러분 안녕하십니까", "이번 보고서에서는 ~를 심층 분석해 드리겠습니다", "다음은 ~입니다" 같은 쓸데없는 인사말이나 서론, 메타 발언을 절대 작성하지 마세요. 곧바로 핵심 분석 내용부터 시작하세요.
      4. 해설 수준: 원본 보고서의 전문적인 팩트와 수치 데이터가 절대 누락되지 않도록 방대하고 꼼꼼하게 담아내되, 경제/금융 용어에 익숙하지 않은 '대학생' 독자가 읽었을 때 마치 친절한 전공 교수님의 강의를 듣는 것처럼 아주 쉽고 완벽하게 이해될 수 있도록 상세히 해설하세요.

      첨부된 한국은행 또는 공공기관의 경제 리포트(PDF) 전체 내용 중, 사용자가 핵심적으로 골라낸 **"${chapterTitle}"** 챕터 단 하나만을 집중적으로 초정밀 심층 분석하세요.

      1. **easyExplanation**: 위 문체 가이드라인을 엄격히 지키면서, 보고서의 내용(특히 차트와 관련된 분석 내용 포함)이 누락되지 않고 대학생 독자에게 매우 쉽게 전달되도록 아주 상세하고 깊이 있게 해설하세요.
         **[시각적 가독성 극대화 (Rich Markdown) 규칙] - 프리미엄 에디토리얼 스타일**
         - 화려한 색상 태그(형광펜, 글자색 등) 사용을 **전면 금지**합니다. 모노톤의 절제된 고급스러움을 지향하세요.
         - **강조 표기**: 문단 내 핵심 키워드나 결론은 깔끔하게 **볼드체(**텍스트**)**만 적용하세요.
         - **인사이트 박스(중요)**: 해당 챕터에서 가장 핵심이 되는 통찰이나 요약 문장(1~2문장)은 반드시 마크다운 인용구(\`>\`)로 빼내어 작성하세요. (렌더링 시 세련된 요약 박스로 표시됩니다.)
         - **표(Table)**: 전년 대비 변화율 등 텍스트로 나열하기보다 표로 비교하는 것이 명확한 데이터는 마크다운 표(\`|구분|내용|\`) 형식으로 삽입하세요.
         - **목록(List)**: 3가지 이상의 특징이나 나열식 설명은 글머리 기호(\`-\`)를 사용하세요.
      2. **charts**: 해당 챕터에 수치 데이터(표, 그래프)가 있다면 가장 중요한 핵심 지표 위주로 차트를 생성하세요. 기존의 '데이터 포인트 5개 제한'은 완전히 폐지되었습니다. **시계열 데이터 등 추이를 보여주는 자료라면 15~20개의 연속된 데이터 포인트라도 모두 추출하여 완벽한 트렌드 차트를 구성하세요.**
      3. **[차트 해설(description) 규칙]**: 차트의 형태(상승/하락)만을 단순 묘사하는 것을 절대 금지합니다. 대신 보고서 본문 내용을 바탕으로 **① '왜 그래프가 이러한 형태(원인/배경)를 띠게 되었는지'**와 **② '이 그래프가 의미하는 바가 구체적으로 무엇인지'**를 명확하게 1~3문장으로 설명하세요. (예: "물가 상승 압력에 대응하기 위해 중앙은행이 기준금리를 인상함에 따라 해당 수치가 급증한 모습이며, 이는 기업의 자금 조달 환경이 악화되고 있음을 의미합니다.")
      
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
            "description": "차트 형태 설명 금지. 왜 그래프가 이런 형태를 띠는지(원인)와 그래프가 의미하는 바를 구체적으로 작성하세요.",
            "dataKeys": ["주택담보대출", "기타대출"],
            "data": [
              { "name": "1월", "주택담보대출": 3.0, "기타대출": -1.6 },
              { "name": "2월", "주택담보대출": 4.1, "기타대출": -1.2 }
            ]
          }
        ]
      }
    `;

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const result = await (async () => {
      let retries = 2; // 일일 한도 방전을 막기 위해 재시도 횟수 축소
      let delay = 15000;
      for (let i = 0; i < retries; i++) {
        try {
          return await model.generateContent([
            prompt,
            {
              fileData: { fileUri, mimeType },
            },
          ]);
        } catch (e: any) {
          if ((e.status === 503 || e.status === 429) && i < retries - 1) {
            console.log(`[Retry analyze-chapter] API Error ${e.status}. Retrying in ${delay}ms... (Attempt ${i + 1}/${retries})`);
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
