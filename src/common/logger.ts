import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // redact sensitive fields (adjust as needed)
  redact: { paths: ["password", "req.headers.authorization"], remove: true },
  transport: process.env.NODE_ENV === "production" ? undefined : {
    target: "pino-pretty",
    options: { translateTime: "SYS:standard" }
  }
});