/* Worker entry point. Loads the WASM module once, then handles "solve"
 * messages by running the C solver synchronously inside the worker thread.
 * Terminate the worker (from the main thread) to cancel an in-flight solve. */

import legionInit from './legion.js';
import { computeLayout, runSolve } from './solve-impl.mjs';

let mod = null;
let layout = null;

self.addEventListener('message', async (e) => {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      mod = await legionInit({
        locateFile: (path) => new URL(path, import.meta.url).href,
      });
      layout = computeLayout(mod);
      self.postMessage({ type: 'ready', layout });
    } catch (err) {
      self.postMessage({ type: 'init-error', error: String(err && err.message || err) });
    }
    return;
  }

  if (msg.type === 'solve') {
    if (!mod || !layout) {
      self.postMessage({
        type: 'error',
        requestId: msg.requestId,
        error: 'solve before init',
      });
      return;
    }
    try {
      const result = runSolve(mod, layout, msg.board, msg.counts, msg.maxIter);
      self.postMessage({ type: 'result', requestId: msg.requestId, result });
    } catch (err) {
      self.postMessage({
        type: 'error',
        requestId: msg.requestId,
        error: String(err && err.message || err),
      });
    }
  }
});
