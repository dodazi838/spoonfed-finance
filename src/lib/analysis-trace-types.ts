export const TRACE_SCHEMA_VERSION = 1;
export const PROMPT_VERSION = '2026-09-30.3';

export type ParseMethod = 'direct' | 'code-block' | 'brace-extraction' | 'partial-recovery' | 'failed';
export interface ParseDiagnostics {
  method: ParseMethod;
  recovered: boolean;
  warnings: string[];
}

export interface AnalysisCallTrace {
  schemaVersion: number;
  analysisId: string;
  requestId: string;
  stage: 'analyze' | 'analyze-chapter';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  status: 'running' | 'success' | 'recovered' | 'error';
  input: { numPages?: number; chapterTitle?: string; chapterRange?: import('./source-chapters').SourceChapter; mode?: 'short' | 'long' };
  versions: { app: string; prompt: string; deployment: string };
  model: { requested: string; reported?: string; temperature: number; maxOutputTokens: number };
  prompt: { text: string; sha256: string };
  attempts: { attempt: number; startedAt: string; durationMs: number; status: 'success' | 'error'; errorStatus?: string }[];
  rawResponse?: string;
  finishReason?: string;
  usage?: unknown;
  parse?: ParseDiagnostics;
  parsedOutput?: unknown;
  output?: unknown;
  transformations: string[];
  error?: { name: string; status?: string };
}

export interface AnalysisSession {
  sourceEvidence?: import('./source-review').SourceEvidence;
  schemaVersion: number;
  analysisId: string;
  createdAt: string;
  ownerId?: string;
  input: { fileName: string; fileSize: number; fileSha256?: string; numPages?: number; pageCountMethod?: string };
  selectedChapters: string[];
  calls: AnalysisCallTrace[];
  clientEvents: { at: string; stage: string; message: string }[];
  feedback?: string;
  result?: unknown;
  displayedMarkdown?: unknown;
  displayVersion?: string;
}
