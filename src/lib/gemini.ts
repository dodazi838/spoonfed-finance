import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

// Gemini API 클라이언트 싱글톤
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
}

export const genAI = new GoogleGenerativeAI(apiKey);

// 공통 Safety Settings (모든 카테고리 허용)
export const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// 모델 인스턴스 생성 헬퍼
export function createModel(modelName: string, maxOutputTokens: number = 8192) {
  return genAI.getGenerativeModel({
    model: modelName,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      maxOutputTokens,
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  });
}
