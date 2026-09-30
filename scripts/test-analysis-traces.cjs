const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

// Execute the actual TypeScript modules with only external services replaced.
// No Gemini requests or production Firestore writes are made by these tests.
function loader(stubs = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(root, file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = new Module(file);
    module.filename = file;
    module.paths = Module._nodeModulePaths(path.dirname(file));
    const nativeRequire = module.require.bind(module);
    module.require = specifier => {
      if (Object.hasOwn(stubs, specifier)) return stubs[specifier];
      if (specifier.startsWith('@/') || specifier.startsWith('.')) {
        const candidate = specifier.startsWith('@/') ? path.join(root, 'src', specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
        if (fs.existsSync(`${candidate}.ts`)) return load(`${candidate}.ts`);
      }
      return nativeRequire(specifier);
    };
    cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file,
    }).outputText;
    module._compile(code, file);
    return module.exports;
  }
  return load;
}

const load = loader();
const { parseAIResponse } = load('src/lib/parse-ai-response.ts');
const { createAnalysisTrace, traceAttempt, setTracePrompt, finishTrace } = load('src/lib/analysis-trace-server.ts');

test('normal responses retain charts; formatting recovery is recorded', () => {
  const text = JSON.stringify({ title: 'Chapter', easyExplanation: 'Body', charts: [{ data: [{ value: -1 }] }] });
  const direct = parseAIResponse(text);
  assert.equal(direct.diagnostics.method, 'direct');
  assert.equal(direct.data.charts[0].data[0].value, -1);
  for (const [raw, method] of [[`\`\`\`json\n${text}\n\`\`\``, 'code-block'], [`prefix ${text} suffix`, 'brace-extraction']]) {
    const parsed = parseAIResponse(raw);
    assert.equal(parsed.diagnostics.method, method);
    assert.deepEqual(parsed.data, direct.data);
  }
});

test('truncated JSON explicitly reports discarded charts', () => {
  const parsed = parseAIResponse('{"title":"Chapter","easyExplanation":"Incomplete body');
  assert.equal(parsed.success, true);
  assert.equal(parsed.diagnostics.method, 'partial-recovery');
  assert.deepEqual(parsed.data.charts, []);
  assert.match(parsed.diagnostics.warnings[0], /차트/);
  assert.equal(parseAIResponse('unparseable').diagnostics.method, 'failed');
});

test('shared analysis ID, unique requests, prompt hash, retry and safe output', async () => {
  const trace = createAnalysisTrace('analyze', 'analysis-123');
  assert.equal(trace.analysisId, 'analysis-123');
  assert.notEqual(trace.requestId, createAnalysisTrace('analyze-chapter', trace.analysisId).requestId);
  assert.notEqual(createAnalysisTrace('analyze', '../invalid').analysisId, '../invalid');
  setTracePrompt(trace, 'Actual prompt');
  assert.match(trace.prompt.sha256, /^[0-9a-f]{64}$/);
  await assert.rejects(traceAttempt(trace, 0, async () => { throw Object.assign(new Error('secret-token-in-url'), { status: 429 }); }));
  await traceAttempt(trace, 1, async () => 'ok');
  trace.parse = { method: 'partial-recovery', recovered: true, warnings: ['Charts lost'] };
  finishTrace(trace, { fileUri: 'secret-file-uri', mimeType: 'application/pdf', title: 'Safe', charts: [] });
  assert.equal(trace.status, 'recovered');
  assert.equal(trace.attempts.length, 2);
  assert.equal(trace.attempts[0].errorStatus, '429');
  assert.deepEqual(trace.output, { title: 'Safe', charts: [] });
  assert.doesNotMatch(JSON.stringify(trace), /secret-token|secret-file-uri/);
});

function modelResponse(text, reason = 'STOP') {
  return { response: { text: () => text, usageMetadata: { totalTokenCount: 12 }, candidates: [{ finishReason: reason }], modelVersion: 'model-version-test' } };
}

function routeLoader(generateContent) {
  return loader({
    '@/lib/gemini': { createModel: () => ({ generateContent }) },
    '@google/generative-ai/server': {}, 'pdf-parse': () => {},
  });
}

function request(stage, body, analysisId = 'analysis-123') {
  return new Request(`http://localhost/api/${stage}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-analysis-id': analysisId }, body: JSON.stringify(body) });
}

test('short and long API branches capture exact prompts and output without file URI', async () => {
  const handler = routeLoader(async () => modelResponse('{"summary":["Summary"],"sections":[{"title":"A","charts":[]}]}'))('src/app/api/analyze/route.ts').POST;
  for (const [pages, mode, limit] of [[5, 'short', 16384], [20, 'long', 8192]]) {
    const response = await handler(request('analyze', { fileUri: 'temporary-file', numPages: pages }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.analysisId, 'analysis-123');
    assert.equal(body.trace.input.mode, mode);
    assert.equal(body.trace.model.maxOutputTokens, limit);
    assert.equal(body.trace.model.reported, 'model-version-test');
    assert.deepEqual(body.chapters, ['A']);
    assert.equal(body.trace.parsedOutput.chapters, undefined);
    assert.deepEqual(body.trace.output.chapters, ['A']);
    assert.doesNotMatch(JSON.stringify(body.trace), /temporary-file/);
  }
});

test('chapter truncation, raw fallback and generated explanation are distinguishable', async () => {
  for (const raw of ['{"title":"A","easyExplanation":"Cut off', 'unparseable', '{"title":"A","easyExplanation":"","charts":[{"title":"Chart","description":"Details"}]}']) {
    const handler = routeLoader(async () => modelResponse(raw, 'MAX_TOKENS'))('src/app/api/analyze-chapter/route.ts').POST;
    const response = await handler(request('analyze-chapter', { fileUri: 'temporary-file', chapterTitle: 'A' }));
    const body = await response.json();
    assert.equal(body.trace.rawResponse, raw);
    assert.equal(body.trace.finishReason, 'MAX_TOKENS');
    assert.ok(body.trace.parse.warnings.some(warning => warning.includes('토큰')));
    if (raw === 'unparseable') {
      assert.equal(body.trace.parse.method, 'failed');
      assert.equal(body.trace.status, 'recovered');
      assert.equal(body.easyExplanation, raw);
    } else if (raw.includes('Cut off')) {
      assert.equal(body.trace.parse.method, 'partial-recovery');
      assert.deepEqual(body.charts, []);
    } else {
      assert.equal(body.trace.parsedOutput.easyExplanation, '');
      assert.match(body.easyExplanation, /Details/);
      assert.ok(body.trace.transformations.length);
    }
  }
});

test('validation and model failures return an analysis ID and failed trace', async () => {
  const handler = routeLoader(async () => { throw Object.assign(new Error('Test model failure'), { status: 400 }); })('src/app/api/analyze-chapter/route.ts').POST;
  for (const [input, status] of [[{}, 400], [{ fileUri: 'file', chapterTitle: 'A' }, 500]]) {
    const response = await handler(request('analyze-chapter', input));
    const body = await response.json();
    assert.equal(response.status, status);
    assert.equal(body.analysisId, 'analysis-123');
    assert.equal(body.trace.status, 'error');
    if (status === 500) assert.equal(body.trace.attempts[0].errorStatus, '400');
  }
});

const localRecords = new Map();
global.window = { dispatchEvent() {} };
global.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
global.indexedDB = {
  open() {
    const request = {};
    request.result = {
      close() {},
      transaction() {
        const transaction = { objectStore: () => ({
          put(value) { localRecords.set(value.analysisId, structuredClone(value)); return { result: value.analysisId }; },
          get(id) { return { result: structuredClone(localRecords.get(id)) }; },
          delete(id) { localRecords.delete(id); return { result: undefined }; },
        }) };
        setImmediate(() => transaction.oncomplete());
        return transaction;
      },
    };
    setImmediate(() => request.onsuccess());
    return request;
  },
};

const sampleSession = () => ({ schemaVersion: 1, analysisId: 'analysis-storage', createdAt: new Date().toISOString(), input: { fileName: 'report.pdf', fileSize: 20 }, selectedChapters: [], calls: [], clientEvents: [] });

test('browser records survive a fresh module, stay owner-scoped, and delete with reports', async () => {
  const store = loader({ './firebase': { db: null } })('src/lib/analysis-trace-store.ts');
  await store.saveAnalysisSession(sampleSession(), 'owner');
  const fresh = loader({ './firebase': { db: null } })('src/lib/analysis-trace-store.ts');
  assert.equal((await fresh.loadAnalysisSession('analysis-storage', 'owner')).analysisId, 'analysis-storage');
  assert.equal(await fresh.loadAnalysisSession('analysis-storage', 'other'), undefined);
  await fresh.deleteAnalysisSession('analysis-storage');
  assert.equal(await fresh.loadAnalysisSession('analysis-storage', 'owner'), undefined);
});

test('storage failure retains exportable in-memory trace and shows failure', async () => {
  const original = global.indexedDB;
  global.indexedDB = { open() { throw new Error('Storage unavailable'); } };
  try {
    const store = loader({ './firebase': { db: null } })('src/lib/analysis-trace-store.ts');
    await store.saveAnalysisSession(sampleSession());
    assert.equal((await store.loadAnalysisSession('analysis-storage')).input.fileName, 'report.pdf');
    assert.match(store.traceStorageStatus('analysis-storage'), /저장 실패/);
  } finally { global.indexedDB = original; }
});

test('large cloud chunks round-trip Korean and astral characters through UTF-8', () => {
  const store = loader({ './firebase': { db: null } })('src/lib/analysis-trace-store.ts');
  const original = '가'.repeat(99999) + '😀' + '나'.repeat(120000);
  const encoded = store.splitTracePayload(original).map(part => new TextDecoder().decode(new TextEncoder().encode(part))).join('');
  assert.equal(encoded, original);
});

function cloudFixture({ failWrites = false, hangWrites = false } = {}) {
  const records = new Map();
  const ref = (...parts) => ({ id: parts.join('/').split('/').at(-1), path: parts.join('/') });
  const snapshot = reference => ({ id: reference.id, ref: reference, exists: () => records.has(reference.path), data: () => records.get(reference.path) });
  return {
    records,
    sdk: {
      collection: (_, ...parts) => ref(...parts),
      doc: (parent, ...parts) => ref(parent.path, ...parts),
      getDoc: async reference => snapshot(reference),
      getDocs: async parent => ({ docs: [...records.keys()].filter(key => key.startsWith(parent.path + '/') && !key.slice(parent.path.length + 1).includes('/')).map(key => snapshot(ref(key))) }),
      writeBatch: () => {
        const changes = [];
        return {
          set: (reference, value) => changes.push(() => records.set(reference.path, structuredClone(value))),
          delete: reference => changes.push(() => records.delete(reference.path)),
          commit: async () => {
            if (failWrites) throw new Error('permission-denied');
            if (hangWrites) return new Promise(() => {});
            changes.forEach(change => change());
          },
        };
      },
    },
  };
}

const tick = () => new Promise(resolve => setImmediate(resolve));
async function settleCloud(store, id, pattern) {
  for (let index = 0; index < 30; index++) {
    if (pattern.test(store.traceStorageStatus(id) || '')) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.match(store.traceStorageStatus(id) || '', pattern);
}

test('cloud round trip uses integrity checks, serialized snapshots, and account scope', async () => {
  const cloud = cloudFixture();
  const stubs = { './firebase': { db: {} }, 'firebase/firestore': cloud.sdk };
  const store = loader(stubs)('src/lib/analysis-trace-store.ts');
  const session = { ...sampleSession(), analysisId: 'analysis-cloud', feedback: '가'.repeat(110000) + '😀' };
  await store.saveAnalysisSession(session, 'owner');
  await store.saveAnalysisSession({ ...session, feedback: 'Latest note' }, 'owner');
  // Deletion waits for the queued writes; use the cloud queue's completion signal.
  await settleCloud(store, session.analysisId, /클라우드와/);
  for (let index = 0; index < 10; index++) await tick();
  localRecords.delete(session.analysisId);
  const fresh = loader(stubs)('src/lib/analysis-trace-store.ts');
  assert.equal((await fresh.loadAnalysisSession(session.analysisId, 'owner')).feedback, 'Latest note');
  assert.equal(await fresh.loadAnalysisSession(session.analysisId, 'other'), undefined);
  const manifestPath = 'users/owner/reports/analysis-cloud/analysisTrace/manifest';
  assert.equal(cloud.records.get(manifestPath).chunkCount, 1);
  assert.equal(cloud.records.has('users/owner/reports/analysis-cloud/analysisTrace/chunk-1'), false);
  await fresh.deleteAnalysisSession(session.analysisId, 'owner');
  assert.equal(cloud.records.size, 0);
});

test('cloud permission failure is visible while local analysis data stays available', async () => {
  const cloud = cloudFixture({ failWrites: true });
  const store = loader({ './firebase': { db: {} }, 'firebase/firestore': cloud.sdk })('src/lib/analysis-trace-store.ts');
  const session = { ...sampleSession(), analysisId: 'analysis-cloud-failure' };
  await store.saveAnalysisSession(session, 'owner');
  await settleCloud(store, session.analysisId, /클라우드 저장 실패/);
  assert.equal((await store.loadAnalysisSession(session.analysisId, 'owner')).analysisId, session.analysisId);
});

test('offline cloud writes do not hold up analysis completion', async () => {
  const cloud = cloudFixture({ hangWrites: true });
  const store = loader({ './firebase': { db: {} }, 'firebase/firestore': cloud.sdk })('src/lib/analysis-trace-store.ts');
  const session = { ...sampleSession(), analysisId: 'analysis-offline' };
  const result = await Promise.race([store.saveAnalysisSession(session, 'owner').then(() => 'saved'), tick().then(() => tick()).then(() => 'delayed')]);
  assert.equal(result, 'saved');
  assert.equal((await store.loadAnalysisSession(session.analysisId, 'owner')).analysisId, session.analysisId);
});

test('cloud corruption is rejected rather than exported as a complete trace', async () => {
  const cloud = cloudFixture();
  const stubs = { './firebase': { db: {} }, 'firebase/firestore': cloud.sdk };
  const store = loader(stubs)('src/lib/analysis-trace-store.ts');
  const session = { ...sampleSession(), analysisId: 'analysis-corrupted' };
  await store.saveAnalysisSession(session, 'owner');
  await settleCloud(store, session.analysisId, /클라우드와/);
  localRecords.delete(session.analysisId);
  cloud.records.get('users/owner/reports/analysis-corrupted/analysisTrace/chunk-0').payload += 'corrupted';
  const fresh = loader(stubs)('src/lib/analysis-trace-store.ts');
  await assert.rejects(fresh.loadAnalysisSession(session.analysisId, 'owner'), /integrity/);
});
