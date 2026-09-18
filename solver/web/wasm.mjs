/* Public client API for the solver.
 *
 * solve() returns a Promise. Under the hood:
 *   - Dev mode (served from a real URL): spawns a Web Worker the first time,
 *     runs solves on it, so the main thread stays responsive and the user can
 *     hit "Stop" mid-solve via cancelSolve().
 *   - Single-file/file:// mode: Worker spawning fails (no module URL), so we
 *     fall back to running WASM on the main thread. Solves still work, just
 *     synchronously — same behavior as before workers existed. */

import legionInit from './legion.js';
import { computeLayout, runSolve } from './solve-impl.mjs';

/* Replaced at build time by build_single_html.ps1 with the bundled worker IIFE
 * encoded as base64. In dev mode this stays as the literal sentinel (~34 chars);
 * the length check below is how we detect "has been replaced". Base64 is used
 * (instead of an escaped JS string literal) because the worker bundle contains
 * the WASM binary as a heavily-escaped JS string, and a second round of
 * escaping was producing invalid syntax. */
const EMBEDDED_WORKER_SRC_B64 = '__LEGION_WORKER_SRC_PLACEHOLDER__';

function decodeEmbeddedWorker() {
  /* base64 -> Uint8Array of UTF-8 bytes (the worker bundle source). */
  const bin = atob(EMBEDDED_WORKER_SRC_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

let mode = 'unknown';     /* 'worker' | 'sync' */
let worker = null;
let mainModule = null;    /* Emscripten Module on the main thread (sync mode) */
let layout = null;
let initPromise = null;
const pending = new Map();
let nextRequestId = 1;

function handleWorkerMessage(e) {
  const msg = e.data;
  if (msg.type !== 'result' && msg.type !== 'error') return;
  const p = pending.get(msg.requestId);
  if (!p) return;
  pending.delete(msg.requestId);
  if (msg.type === 'result') p.resolve(msg.result);
  else                       p.reject(new Error(msg.error));
}

/* Wait for the worker's 'ready' (or 'init-error') reply to an 'init' message. */
function initWorker(w) {
  return new Promise((resolve, reject) => {
    const onMsg = (e) => {
      if (e.data.type === 'ready') {
        cleanup();
        resolve(e.data.layout);
      } else if (e.data.type === 'init-error') {
        cleanup();
        reject(new Error(e.data.error));
      }
    };
    const onErr = (e) => {
      cleanup();
      reject(new Error(e.message || 'worker error'));
    };
    const cleanup = () => {
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
    };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    w.postMessage({ type: 'init' });
  });
}

async function trySpawnWorker() {
  /* Path 1: dev mode — wasm.mjs is served from a real URL, so we can build
   * one for worker.mjs and spawn a module worker. */
  if (typeof import.meta !== 'undefined' && import.meta.url) {
    try {
      const workerUrl = new URL('./worker.mjs', import.meta.url);
      const w = new Worker(workerUrl, { type: 'module' });
      try {
        const ready = await initWorker(w);
        layout = ready;
        worker = w;
        worker.addEventListener('message', handleWorkerMessage);
        return w;
      } catch (err) {
        w.terminate();
        console.warn('[legion-solver] URL-worker init failed:', err);
        /* fall through to path 2 */
      }
    } catch {
      /* fall through to path 2 */
    }
  }

  /* Path 2: single-file build — the worker source is inlined (as base64) at
   * build time. Decode and spawn from a Blob URL so file:// works too. */
  if (EMBEDDED_WORKER_SRC_B64.length > 1000) {
    let blobUrl = null;
    try {
      const bytes = decodeEmbeddedWorker();
      const blob = new Blob([bytes], { type: 'application/javascript' });
      blobUrl = URL.createObjectURL(blob);
      const w = new Worker(blobUrl);  /* classic worker — embedded source is an IIFE */
      try {
        const ready = await initWorker(w);
        layout = ready;
        worker = w;
        worker.addEventListener('message', handleWorkerMessage);
        URL.revokeObjectURL(blobUrl);
        return w;
      } catch (err) {
        w.terminate();
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        console.warn('[legion-solver] Blob-worker init failed:', err);
      }
    } catch (err) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      console.warn('[legion-solver] Blob-worker spawn failed:', err);
    }
  }

  return null;
}

async function initSyncFallback() {
  mainModule = await legionInit({
    locateFile: (path) => new URL(path, import.meta.url).href,
  });
  layout = computeLayout(mainModule);
}

export async function initSolver() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const w = await trySpawnWorker();
    if (w) {
      mode = 'worker';
      console.log('[legion-solver] using Web Worker — UI stays responsive during solve');
      return;
    }
    await initSyncFallback();
    mode = 'sync';
    console.log('[legion-solver] worker unavailable, solving on main thread (page may freeze on big solves)');
  })();
  return initPromise;
}

export function getLayout() {
  if (!layout) throw new Error('initSolver() not awaited yet');
  return layout;
}

export function isAsync() { return mode === 'worker'; }

export async function solve(board, counts, maxIter = 0) {
  if (!initPromise) initSolver();
  await initPromise;

  if (mode === 'worker') {
    const requestId = nextRequestId++;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      /* Copy buffers — main thread keeps ownership of state.board / state.counts. */
      worker.postMessage({
        type: 'solve',
        requestId,
        board:   new Int8Array(board),
        counts:  new Int32Array(counts),
        maxIter,
      });
    });
  }

  /* Sync fallback: run on main thread. Wrapped in Promise so the call site
   * still awaits. */
  return runSolve(mainModule, layout, board, counts, maxIter);
}

/* Cancel the in-flight solve, if any. Only meaningful in worker mode.
 * Returns true if a solve was cancelled, false otherwise (e.g. sync mode). */
export function cancelSolve() {
  if (mode !== 'worker' || !worker) return false;
  const dead = worker;
  worker = null;
  initPromise = null;
  layout = null;
  mode = 'unknown';
  for (const p of pending.values()) p.reject(new Error('cancelled'));
  pending.clear();
  dead.terminate();
  /* Eagerly spin up a fresh worker so the next click on Solve is instant
   * (and isAsync() returns true again before we even reach actionSolve). */
  initSolver();
  return true;
}
