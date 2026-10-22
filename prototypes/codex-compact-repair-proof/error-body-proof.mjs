import assert from 'node:assert/strict';
import { mock } from 'node:test';

// An isolated reader prototype, not wired into the production retry classifier.
// Preserve both HTTP status and read outcome so the caller can classify them separately.
async function readErrorBody(response, signal, attempt, clock, milliseconds = 300_000) {
  const reader = response.body.getReader();
  let rejectStopped;
  const stopped = new Promise((_resolve, reject) => { rejectStopped = reject; });
  const abort = () => {
    rejectStopped(Object.assign(new Error('Cancelled'), { outcome: 'aborted' }));
    attempt.abort();
  };
  const timer = clock.set(() => {
    rejectStopped(Object.assign(new Error('Error body deadline exceeded'), { outcome: 'deadline' }));
    attempt.abort();
  }, milliseconds);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const decoder = new TextDecoder();
  let body = '';
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), stopped]);
      if (chunk.done) return { status: response.status, outcome: 'complete', body: body + decoder.decode() };
      body += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error) {
    return { status: response.status, outcome: signal.aborted ? 'aborted' : error.outcome ?? 'read-error', body };
  } finally {
    clock.clear(timer);
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function prove(record) {
  for (const mode of ['stalled-503', 'stalled-401', 'cancelled', 'continuous-chunks', 'complete']) {
    mock.timers.enable({ apis: ['setTimeout'] });
    const active = new Set();
    const clock = { set: (fn, ms) => { const id = setTimeout(fn, ms); active.add(id); return id; },
      clear: id => { clearTimeout(id); active.delete(id); } };
    const external = new AbortController(), attempt = new AbortController();
    let stream, cancelled = false;
    const response = new Response(new ReadableStream({ start(controller) { stream = controller; }, cancel() { cancelled = true; } }),
      { status: mode === 'stalled-401' ? 401 : 503 });
    try {
      const running = readErrorBody(response, external.signal, attempt, clock);
      if (mode === 'cancelled') external.abort();
      else if (mode === 'complete') { stream.enqueue(new TextEncoder().encode('failure details')); stream.close(); }
      else {
        for (let index = 0; index < 3; index++) {
          if (mode === 'continuous-chunks') stream.enqueue(new TextEncoder().encode('chunk'));
          for (let tick = 0; tick < 5; tick++) await Promise.resolve();
          mock.timers.tick(100_000);
        }
      }
      const output = await running;
      const expected = mode === 'complete' ? 'complete' : mode === 'cancelled' ? 'aborted' : 'deadline';
      assert.equal(output.outcome, expected);
      assert.equal(output.status, mode === 'stalled-401' ? 401 : 503);
      assert.equal(active.size, 0);
      assert.equal(response.body.locked, false);
      if (expected !== 'complete') assert.equal(cancelled, true);
      if (expected === 'deadline') assert.equal(attempt.signal.aborted, true);
      if (expected === 'aborted') assert.equal(attempt.signal.aborted, true);
      record(`P7-candidate-${mode}`, { status: output.status, outcome: output.outcome, timersLeft: active.size,
        bodyUnlocked: !response.body.locked, attemptAborted: attempt.signal.aborted,
        scope: 'Bounded reader only; production HTTP retry and fallback classifier not replaced.' });
    } finally { mock.timers.reset(); }
  }
}
