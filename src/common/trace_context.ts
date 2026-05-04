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

  static enterBackground(task: string): void {
    TraceContext.als.enterWith({
      trace_id: `bg:${task}:${Id.generate(BG_TRACE_ID_LEN)}`,
      kind: 'bg',
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
}
