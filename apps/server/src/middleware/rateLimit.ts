import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { RequestHandler } from 'express';
import { getRedis } from '../db/redis.js';

// When RATE_LIMIT_DISABLED=true all limiters pass through (dev/test mode)
const disabled = process.env.RATE_LIMIT_DISABLED === 'true';
const noop: RequestHandler = (_req, _res, next) => next();

function makeStore(prefix: string) {
  const client = getRedis();
  if (!client) return undefined; // falls back to in-memory if Redis unavailable

  return new RedisStore({
    // rate-limit-redis expects a sendCommand function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendCommand: (...args: string[]) => (client as any).call(...args),
    prefix: `rl:${prefix}:`,
  });
}

// General API: 300 req/min
export const generalLimiter: RequestHandler = disabled ? noop : rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('general'),
  message: { error: 'Too many requests, please try again after 1 minute.' },
});

// Auth endpoints: 50 req/15min (brute-force protection)
export const authLimiter: RequestHandler = disabled ? noop : rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('auth'),
  message: { error: 'Too many login attempts, please try again after 15 minutes.' },
});

// AI endpoints: 60 req/min
export const aiLimiter: RequestHandler = disabled ? noop : rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('ai'),
  message: { error: 'AI request limit reached, please wait a moment.' },
});
