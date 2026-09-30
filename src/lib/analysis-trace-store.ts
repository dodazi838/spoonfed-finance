'use client';

import { collection, doc, getDocs, writeBatch, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { AnalysisSession, AnalysisCallTrace } from './analysis-trace-types';

export const TRACE_EVENT = 'spoonfed-trace-updated';
const DATABASE = 'spoonfed-analysis-traces';
const STORE = 'sessions';
const memory = new Map<string, AnalysisSession>();
const states = new Map<string, string>();
const cloudQueues = new Map<string, Promise<void>>();
const deleting = new Set<string>();
let localRetryAfter = 0;

function notify(id: string, status: string) {
  states.set(id, status);
  window.dispatchEvent(new CustomEvent(TRACE_EVENT, { detail: id }));
}

function openDatabase(): Promise<IDBDatabase> {
  if (Date.now() < localRetryAfter) return Promise.reject(new Error('Trace storage temporarily unavailable'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      localRetryAfter = Date.now() + 60000;
      reject(new Error('Trace storage unavailable'));
    };
    const timer = setTimeout(fail, 3000);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'analysisId' });
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      clearTimeout(timer);
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = fail;
    request.onblocked = fail;
  });
}

async function localOperation<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      const timer = setTimeout(() => {
        localRetryAfter = Date.now() + 60000;
        transaction.abort();
        reject(new Error('Trace transaction timed out'));
      }, 3000);
      transaction.oncomplete = () => { clearTimeout(timer); resolve(request.result); };
      transaction.onerror = () => { clearTimeout(timer); reject(transaction.error); };
      transaction.onabort = () => { clearTimeout(timer); reject(transaction.error); };
    });
  } finally { database.close(); }
}

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function traceStorageStatus(id: string): string | undefined { return states.get(id); }

// Store large records outside localStorage, which also contains the report archive.
export async function saveAnalysisSession(session: AnalysisSession, userId?: string): Promise<void> {
  if (deleting.has(session.analysisId)) return;
  const previousOwner = memory.get(session.analysisId)?.ownerId || session.ownerId;
  if (previousOwner && previousOwner !== userId) return;
  session.ownerId = previousOwner || userId;
  const snapshot: AnalysisSession = JSON.parse(JSON.stringify({ ...session, ownerId: session.ownerId || userId }));
  memory.set(session.analysisId, snapshot);
  let localSaved = false;
  try {
    await localOperation('readwrite', store => store.put(snapshot));
    localSaved = true;
    notify(session.analysisId, '이 브라우저에 저장됨');
  } catch {
    notify(session.analysisId, '브라우저 저장 실패 — 기록을 지금 다운로드하세요');
  }
  if (!userId || !db || (snapshot.ownerId && snapshot.ownerId !== userId)) return;

  // Cloud failure or an offline SDK must never delay report rendering. Serialize writes
  // so a slower earlier snapshot cannot overwrite a later completed session.
  const previous = cloudQueues.get(session.analysisId) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    if (deleting.has(session.analysisId)) return;
    const cloud = db!;
    const text = JSON.stringify(snapshot);
    const chunks = splitTracePayload(text);
    const traces = collection(cloud, 'users', userId, 'reports', session.analysisId, 'analysisTrace');
    const payloadHash = await sha256(new TextEncoder().encode(text).buffer);
    const oldManifest = await getDoc(doc(traces, 'manifest'));
    const oldCount = oldManifest.exists() ? Number(oldManifest.data().chunkCount) || 0 : 0;
    if (Math.max(oldCount, chunks.length) > 400) throw new Error('Trace is too large');
    const batch = writeBatch(cloud);
    chunks.forEach((payload, index) => batch.set(doc(traces, `chunk-${index}`), { payload }));
    for (let index = chunks.length; index < oldCount; index++) batch.delete(doc(traces, `chunk-${index}`));
    batch.set(doc(traces, 'manifest'), { schemaVersion: 1, chunkCount: chunks.length, sha256: payloadHash });
    await batch.commit();
    if (memory.get(session.analysisId) === snapshot) notify(session.analysisId, localSaved ? '클라우드와 이 브라우저에 저장됨' : '클라우드에 저장됨 · 브라우저 저장 실패');
  }).catch(() => {
    if (memory.get(session.analysisId) === snapshot) notify(session.analysisId, localSaved ? '이 브라우저에 저장됨 · 클라우드 저장 실패' : '저장 실패 — 기록을 지금 다운로드하세요');
  });
  cloudQueues.set(session.analysisId, next);
}

// At most 100,000 UTF-16 code units per document (under Firestore's document limit).
export function splitTracePayload(text: string): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length;) {
    let end = Math.min(index + 100000, text.length);
    // Do not split a surrogate pair: cloud UTF-8 encoding would replace both halves.
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    chunks.push(text.slice(index, end));
    index = end;
  }
  return chunks;
}

export async function loadAnalysisSession(id: string, userId?: string): Promise<AnalysisSession | undefined> {
  const allowed = (session?: AnalysisSession) => session && (!session.ownerId || session.ownerId === userId) ? session : undefined;
  const cached = allowed(memory.get(id));
  if (cached) return cached;
  try {
    const local = allowed(await localOperation<AnalysisSession | undefined>('readonly', store => store.get(id)));
    if (local) { memory.set(id, local); return local; }
  } catch { /* Cloud remains available when IndexedDB is disabled. */ }
  if (!userId || !db) return undefined;
  const traces = collection(db, 'users', userId, 'reports', id, 'analysisTrace');
  const manifest = await getDoc(doc(traces, 'manifest'));
  if (!manifest.exists()) return undefined;
  const count = Number(manifest.data().chunkCount);
  if (!Number.isInteger(count) || count < 1 || count > 400) throw new Error('Invalid trace manifest');
  const documents = await getDocs(traces);
  const parts = new Map(documents.docs.map(item => [item.id, item.data().payload]));
  const chunks = Array.from({ length: count }, (_, index) => parts.get(`chunk-${index}`));
  if (chunks.some(part => typeof part !== 'string')) throw new Error('Incomplete trace');
  const text = chunks.join('');
  if (await sha256(new TextEncoder().encode(text).buffer) !== manifest.data().sha256) throw new Error('Trace integrity check failed');
  const session = allowed(JSON.parse(text) as AnalysisSession);
  if (!session || session.analysisId !== id) throw new Error('Invalid trace owner or ID');
  memory.set(id, session);
  return session;
}

export async function captureAnalysisCall(session: AnalysisSession, trace?: AnalysisCallTrace, userId?: string) {
  if (!trace || trace.analysisId !== session.analysisId) return;
  session.calls = [...session.calls.filter(call => call.requestId !== trace.requestId), trace];
  session.feedback = memory.get(session.analysisId)?.feedback ?? session.feedback;
  await saveAnalysisSession(session, userId);
}

export async function deleteAnalysisSession(id: string, userId?: string) {
  deleting.add(id);
  try {
    if (userId && db) {
      // Wait for this session's pending writes before removing its cloud chunks.
      await cloudQueues.get(id);
      const cloud = db;
      const snapshot = await getDocs(collection(cloud, 'users', userId, 'reports', id, 'analysisTrace'));
      for (let index = 0; index < snapshot.docs.length; index += 400) {
        const batch = writeBatch(cloud);
        snapshot.docs.slice(index, index + 400).forEach(item => batch.delete(item.ref));
        await batch.commit();
      }
    }
    await localOperation('readwrite', store => store.delete(id));
    memory.delete(id);
    states.delete(id);
    cloudQueues.delete(id);
  } catch (error) {
    deleting.delete(id);
    throw error;
  }
}
