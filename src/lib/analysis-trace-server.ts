import { createHash, randomUUID } from 'node:crypto';
import { version } from '../../package.json';
import { PROMPT_VERSION, TRACE_SCHEMA_VERSION, type AnalysisCallTrace } from './analysis-trace-types';

const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(value);

export function createAnalysisTrace(stage: AnalysisCallTrace['stage'], analysisId?: unknown): AnalysisCallTrace {
  return {
    schemaVersion: TRACE_SCHEMA_VERSION,
    analysisId: validId(analysisId) ? analysisId : randomUUID(),
    requestId: randomUUID(), stage, startedAt: new Date().toISOString(), status: 'running',
    input: {},
    versions: { app: version, prompt: PROMPT_VERSION, deployment: process.env.VERCEL_GIT_COMMIT_SHA || process.env.APP_BUILD_COMMIT || 'local-unversioned' },
    model: { requested: '', temperature: 0.1, maxOutputTokens: 8192 },
    prompt: { text: '', sha256: '' }, attempts: [], transformations: [],
  };
}

export function setTracePrompt(trace: AnalysisCallTrace, text: string) {
  trace.prompt = { text, sha256: createHash('sha256').update(text).digest('hex') };
}

export async function traceAttempt<T>(trace: AnalysisCallTrace, attempt: number, run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  try {
    const value = await run();
    trace.attempts.push({ attempt: attempt + 1, startedAt, durationMs: Date.now() - started, status: 'success' });
    return value;
  } catch (error) {
    trace.attempts.push({ attempt: attempt + 1, startedAt, durationMs: Date.now() - started, status: 'error', errorStatus: safeError(error).status });
    throw error;
  }
}

// Keep SDK request URLs, credentials and uploaded file URIs out of the exported record.
export function safeError(error: unknown): { name: string; status?: string } {
  const data = error as { name?: unknown; status?: unknown; statusCode?: unknown } | null;
  const status = data?.status ?? data?.statusCode;
  return { name: typeof data?.name === 'string' ? data.name.slice(0, 80) : 'Error', status: typeof status === 'number' ? String(status) : undefined };
}

export function finishTrace(trace: AnalysisCallTrace, output?: unknown, error?: unknown) {
  trace.completedAt = new Date().toISOString();
  trace.durationMs = Date.now() - Date.parse(trace.startedAt);
  trace.status = error ? 'error' : trace.parse?.recovered ? 'recovered' : 'success';
  if (output) {
    // Snapshot before attaching the trace; omit the temporary Google file capability.
    const copy = { ...(output as Record<string, unknown>) };
    delete copy.fileUri;
    delete copy.mimeType;
    delete copy.trace;
    trace.output = JSON.parse(JSON.stringify(copy));
  }
  if (error) trace.error = safeError(error);
  return trace;
}
