import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';

// 當 RATE_LIMIT_DISABLED=true 時，所有 limiter 直接放行（生產無限制模式）
const disabled = process.env.RATE_LIMIT_DISABLED === 'true';

const noop: RequestHandler = (_req, _res, next) => next();

// 一般 API：每分鐘 300 次（或無限制）
export const generalLimiter: RequestHandler = disabled ? noop : rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again after 1 minute.' },
});

// Auth 端點：每 15 分鐘 50 次（防止暴力破解，仍需基本保護）
export const authLimiter: RequestHandler = disabled ? noop : rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again after 15 minutes.' },
});

// AI 端點：每分鐘 60 次（或無限制）
export const aiLimiter: RequestHandler = disabled ? noop : rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI request limit reached, please wait a moment.' },
});
