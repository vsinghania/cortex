/**
 * An abortable sleep. A `Retry-After` from a throttled provider can be a minute or
 * more, and a job sleeping through SIGTERM would hold the worker's drain open for
 * exactly that long, so every wait a handler can sit in takes the job's signal.
 */
export class Delay {
  private constructor() {}

  static forMs(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Aborted'));
    if (ms <= 0) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      function onAbort() {
        clearTimeout(timer);
        reject(signal?.reason ?? new Error('Aborted'));
      }

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
