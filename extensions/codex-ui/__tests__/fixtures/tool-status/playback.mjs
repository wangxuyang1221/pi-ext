/** Emit only scripted progress events; no animation or polling loop. */
export function playTimeline(script, signal, emit) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const updates = script.updates ?? [];
    let index = 0;
    let timer;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); resolve(false); };
    signal?.addEventListener("abort", abort, { once: true });
    const schedule = () => {
      const next = updates[index];
      timer = setTimeout(() => {
        if (!next) { cleanup(); resolve(true); return; }
        try { emit?.(next.text); } catch (error) { cleanup(); reject(error); return; }
        if (signal?.aborted) return;
        index++;
        schedule();
      }, Math.max(0, (next?.at ?? script.durationMs) - (Date.now() - started)));
    };
    schedule();
  });
}
