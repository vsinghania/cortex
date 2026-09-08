import { AsyncLocalStorage } from 'node:async_hooks';
import { Id } from '../lib/id.js';
import type { TraceStore } from './types/trace_context.types.js';

const BG_TRACE_ID_LEN = 8;

export class TraceContext {
  private static als = new AsyncLocalStorage<TraceStore>();

  private constructor() {}

  static enter(store: TraceStore): void {
    TraceContext.als.enterWith(store);
  }

  /**
   * Scoped alternative to enter(). enter() uses enterWith(), which mutates the
   * ambient context in place and cannot be unwound, so two logical operations
   * started in the same tick clobber each other's store. Use this whenever
   * operations run concurrently - the job worker running N jobs, for example.
   */
  static async run<T>(store: TraceStore, fn: () => Promise<T>): Promise<T> {
    return TraceContext.als.run(store, fn);
  }

  static enterBackground(task: string): void {
    TraceContext.als.enterWith({
      trace_id: `bg:${task}:${Id.generateRandom(BG_TRACE_ID_LEN)}`,
    });
  }

  static get(): TraceStore | undefined {
    return TraceContext.als.getStore();
  }

  static getTraceId(): string | undefined {
    return TraceContext.als.getStore()?.trace_id;
  }

  static getUserId(): string | undefined {
    return TraceContext.als.getStore()?.user_id;
  }

  static setUserId(user_id: string): void {
    const current = TraceContext.als.getStore();
    if (!current) {
      TraceContext.als.enterWith({ trace_id: `bg:auth:${Id.generateRandom(BG_TRACE_ID_LEN)}`, user_id });
      return;
    }
    if (current.user_id === user_id) return;
    TraceContext.als.enterWith({ ...current, user_id });
  }
}
