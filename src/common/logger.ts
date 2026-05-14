import pino from "pino";
import { TraceContext } from "./trace_context.js";

class CallerFrame {
  private static readonly SKIP_MARKERS = [
    '/node_modules/',
    '/common/logger.ts',
    '/common/logger.js',
    '/lib/decorators/logging_decorators'
  ];

  static resolve(): string | undefined {
    const stack = new Error().stack;
    if (!stack) return undefined;
    const lines = stack.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (CallerFrame.shouldSkip(line)) continue;
      const parsed = CallerFrame.parse(line);
      if (parsed) return parsed;
    }
    return undefined;
  }

  private static shouldSkip(line: string): boolean {
    return CallerFrame.SKIP_MARKERS.some((m) => line.includes(m));
  }

  private static parse(line: string): string | undefined {
    const m = line.match(/at\s+(?:async\s+)?(?:(.+?)\s+\()?(.+?):(\d+):\d+\)?$/);
    if (!m) return undefined;
    const [, fn, file_path, line_no] = m;
    const rel = CallerFrame.toRelative(file_path);
    return fn ? `${rel}:${line_no} (${fn})` : `${rel}:${line_no}`;
  }

  private static readonly ROOT_MARKERS = ['/src/', '/dist/', '/scripts/'];

  private static toRelative(file_path: string): string {
    const cleaned = file_path.replace(/^file:\/\//, '');
    for (const marker of CallerFrame.ROOT_MARKERS) {
      const idx = cleaned.lastIndexOf(marker);
      if (idx >= 0) return cleaned.slice(idx + 1);
    }
    return cleaned;
  }
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: { paths: ["password", "req.headers.authorization"], censor: "[REDACTED]" },
  mixin() {
    const out: Record<string, unknown> = {};
    const store = TraceContext.get();
    if (store) {
      out.trace_id = store.trace_id;
      if (store.user_id) out.user_id = store.user_id;
      if (store.upstream_trace_id) out.upstream_trace_id = store.upstream_trace_id;
    }
    const caller = CallerFrame.resolve();
    if (caller) out.caller = caller;
    return out;
  },
  transport: process.env.NODE_ENV === "production" ? undefined : {
    target: "pino-pretty",
    options: { translateTime: "SYS:standard" }
  }
});
