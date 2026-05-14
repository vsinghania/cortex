import pino from "pino";
import { TraceContext } from "./trace_context.js";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: { paths: ["password", "req.headers.authorization"], censor: "[REDACTED]" },
  mixin() {
    const store = TraceContext.get();
    if (!store) return {};
    const out: Record<string, unknown> = { trace_id: store.trace_id };
    if (store.user_id) out.user_id = store.user_id;
    if (store.upstream_trace_id) out.upstream_trace_id = store.upstream_trace_id;
    return out;
  },
  transport: process.env.NODE_ENV === "production" ? undefined : {
    target: "pino-pretty",
    options: { translateTime: "SYS:standard" }
  }
});
