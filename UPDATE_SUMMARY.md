# 🚀 Update Summary (July 15, 2026)

이 문서는 다른 PC 환경에서 작업 시 IDE(또는 AI 어시스턴트)가 최근 구현된 기능과 아키텍처 변경 사항을 빠르게 파악할 수 있도록 작성된 요약 문서입니다.

## 1. 분석 매커니즘 개편: Short Report One-pass Analysis
- **문제점:** 짧은 보고서(10페이지 이하)라도 '목차 추출' → '챕터 개별 분석'이라는 다중 API 호출 구조를 거치면서 과도한 토큰 소모(1건당 최대 10만 토큰) 및 지연 발생.
- **해결책 (`src/app/api/analyze/route.ts`):** 
  - `pdf-parse`를 도입하여 백엔드에서 업로드된 PDF의 페이지 수를 즉시 스캔.
  - 10페이지 이하(`isShortReport === true`)인 경우, 한 번의 프롬프트로 **요약 + 일상 영향 + 섹션별 심층 분석(sections) + 차트 데이터**를 일괄 추출(One-pass).
  - 해당 요청의 `maxOutputTokens`를 16384로 상향하여 응답 잘림(Truncation) 방지.
- **UI 반영 (`src/app/page.tsx`):** `isShortReport`가 true로 반환되면 목차 선택 단계(`step = 'select'`)를 우회하고 바로 심층 분석 결과 화면(`step = 'analyze'`)으로 자동 점프하도록 분기 처리.

## 2. 토큰 사용량 트래킹 위젯 도입 (localStorage)
- **개요 (`src/app/page.tsx` & `src/components/ReportResult.tsx`):**
  - 기존에는 현재 세션의 토큰 사용량만 표기되었으나, 일일 한도(1,000,000 Tokens) 관리를 위해 브라우저 `localStorage` 기반 누적 기록 시스템 구축.
  - 우측 상단 고정(`fixed`) 위젯으로 일일 무료 한도 대비 소진율을 보여주는 프로그레스 바 구현.
  - 매일 자정 기준(브라우저 Date 기준) 자동 리셋 로직 적용.

## 3. 마크다운 및 JSON 파싱 안정화
- **JSON 파싱 3중 폴백 구조 (`src/app/api/analyze-chapter/route.ts` & `analyze/route.ts`):** 
  - 프롬프트 응답에 마크다운 백틱(```json)이 포함되거나, 토큰 제한으로 응답이 잘렸을 때를 대비하여 정규식과 중괄호 `{}` 스캔 방식을 조합한 다중 파싱 로직 구현.
  - JSON 파싱에 완전히 실패할 경우 에러를 뱉는 대신, 원시 텍스트(Raw Text)를 `easyExplanation`에 강제 주입하여 사용자에게 텍스트라도 노출하는 Fallback 메커니즘 도입.

## 4. UI/UX 및 디자인 고도화
- **타이포그래피 및 레이아웃 (`ReportResult.module.css`):**
  - 소제목 및 문단 간 여백을 밀도 있게 압축하여 화면 가독성 개선 (Margin/Padding 축소).
  - 강조 텍스트(볼드체, 형광펜) 시인성 최적화.
  - AI 프롬프트에 '수평선(hr) 남발 금지' 규칙을 추가하고, CSS 상에서도 구분선 스타일을 은은하게(`#f1f5f9`) 조정하여 미니멀하고 프리미엄한 리포트 디자인 달성.
