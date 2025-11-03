import rateLimit from 'express-rate-limit';

// Parse a number from env with a fallback
function num(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

// Generic limiter factory
export function createRateLimiter(params: {
  windowMs?: number;
  max?: number;
  message?: string;
}) {
  const windowMs = params.windowMs ?? 15 * 60 * 1000; // 15 minutes default
  const max = params.max ?? 100; // limit each IP
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true, // Return rate limit info in the RateLimit-* headers
    legacyHeaders: false,
    message: { error: params.message ?? 'Too many requests, please try again later.' }
  });
}

// Stricter limiter for auth endpoints (login/register/refresh/logout)
export const authRateLimiter = createRateLimiter({
  windowMs: num('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  max: num('AUTH_RATE_LIMIT_MAX', 60),
  message: 'Too many auth requests, please try again later.'
});
