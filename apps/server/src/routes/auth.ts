import type { Express, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { pool } from '../db/client.js';
import { signToken, authMiddleware, type AuthRequest } from '../middleware/auth.js';

const OTP_EXPIRES_IN_SECONDS = 300;
const OTP_RETRY_AFTER_SECONDS = 30;
const OTP_MAX_ATTEMPTS = 5;

interface OtpSession {
  otpRequestId: string;
  phone: string;
  code: string;
  expiresAt: number;
  retryAfterAt: number;
  attempts: number;
}

const otpSessions = new Map<string, OtpSession>();
const phoneRetryAfter = new Map<string, number>();

function normalizePhone(rawPhone: unknown): string {
  return String(rawPhone ?? '').trim().replace(/[\s()-]/g, '');
}

function isValidPhone(phone: string): boolean {
  return /^\+?[1-9]\d{7,14}$/.test(phone);
}

function getRequestId(req: Request, res: Response): string {
  return String((req as any).requestId ?? res.getHeader('X-Request-ID') ?? randomUUID());
}

function buildPhoneEmail(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `phone_${digits}@phone.pegn.local`;
}

function buildPhoneDisplayName(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const last4 = digits.slice(-4).padStart(4, '*');
  return `Phone ${last4}`;
}

export function registerAuthRoutes(app: Express): void {

  // POST /api/v1/auth/phone/request
  app.post('/api/v1/auth/phone/request', async (req: Request, res: Response) => {
    const requestId = getRequestId(req, res);
    const phone = normalizePhone(req.body?.phone);

    if (!phone || !isValidPhone(phone)) {
      res.status(400).json({
        error: 'valid phone is required',
        error_code: 'INVALID_PHONE',
        request_id: requestId,
      });
      return;
    }

    const now = Date.now();
    const retryAt = phoneRetryAfter.get(phone) ?? 0;
    if (retryAt > now) {
      res.status(429).json({
        error: 'OTP recently sent. Please retry later.',
        error_code: 'OTP_RATE_LIMITED',
        request_id: requestId,
        retry_after: Math.ceil((retryAt - now) / 1000),
      });
      return;
    }

    const otpRequestId = randomUUID();
    const code = String(process.env.AUTH_OTP_STUB_CODE ?? '123456');
    const session: OtpSession = {
      otpRequestId,
      phone,
      code,
      expiresAt: now + OTP_EXPIRES_IN_SECONDS * 1000,
      retryAfterAt: now + OTP_RETRY_AFTER_SECONDS * 1000,
      attempts: 0,
    };

    otpSessions.set(otpRequestId, session);
    phoneRetryAfter.set(phone, session.retryAfterAt);

    res.status(202).json({
      request_id: requestId,
      otp_request_id: otpRequestId,
      channel: 'sms',
      expires_in: OTP_EXPIRES_IN_SECONDS,
      retry_after: OTP_RETRY_AFTER_SECONDS,
      stub: true,
      ...(process.env.NODE_ENV !== 'production' ? { debug_code: code } : {}),
    });
  });

  // POST /api/v1/auth/phone/verify
  app.post('/api/v1/auth/phone/verify', async (req: Request, res: Response) => {
    const requestId = getRequestId(req, res);
    const otpRequestId = String(req.body?.otp_request_id ?? req.body?.otpRequestId ?? '').trim();
    const code = String(req.body?.code ?? '').trim();
    const phone = normalizePhone(req.body?.phone);

    if (!otpRequestId || !code) {
      res.status(400).json({
        error: 'otp_request_id and code are required',
        error_code: 'INVALID_PAYLOAD',
        request_id: requestId,
      });
      return;
    }

    const session = otpSessions.get(otpRequestId);
    if (!session) {
      res.status(404).json({
        error: 'OTP request not found',
        error_code: 'OTP_REQUEST_NOT_FOUND',
        request_id: requestId,
      });
      return;
    }

    if (phone && phone !== session.phone) {
      res.status(400).json({
        error: 'phone does not match otp request',
        error_code: 'PHONE_MISMATCH',
        request_id: requestId,
      });
      return;
    }

    const now = Date.now();
    if (session.expiresAt <= now) {
      otpSessions.delete(otpRequestId);
      res.status(410).json({
        error: 'OTP expired',
        error_code: 'OTP_EXPIRED',
        request_id: requestId,
      });
      return;
    }

    if (session.attempts >= OTP_MAX_ATTEMPTS) {
      otpSessions.delete(otpRequestId);
      res.status(429).json({
        error: 'Too many attempts',
        error_code: 'OTP_ATTEMPTS_EXCEEDED',
        request_id: requestId,
      });
      return;
    }

    if (code !== session.code) {
      session.attempts += 1;
      otpSessions.set(otpRequestId, session);
      res.status(401).json({
        error: 'Invalid OTP code',
        error_code: 'OTP_INVALID_CODE',
        request_id: requestId,
        attempts_remaining: Math.max(0, OTP_MAX_ATTEMPTS - session.attempts),
      });
      return;
    }

    try {
      const p = pool;
      if (!p) {
        res.status(503).json({
          error: 'Database not initialized',
          error_code: 'DB_UNAVAILABLE',
          request_id: requestId,
        });
        return;
      }

      const phoneEmail = buildPhoneEmail(session.phone);
      const existing = await p.query(
        'SELECT id, email, name FROM users WHERE email = $1 LIMIT 1',
        [phoneEmail]
      );

      let user = existing.rows[0];
      if (!user) {
        const insertResult = await p.query(
          'INSERT INTO users (email, password_hash, name) VALUES ($1, NULL, $2) RETURNING id, email, name',
          [phoneEmail, buildPhoneDisplayName(session.phone)]
        );
        user = insertResult.rows[0];
      }

      const token = signToken(user.id, user.email);
      otpSessions.delete(otpRequestId);

      res.json({
        request_id: requestId,
        auth_method: 'phone_otp',
        token,
        user: { id: user.id, email: user.email, name: user.name },
      });
    } catch (err) {
      console.error('[auth] phone verify error', err);
      res.status(500).json({
        error: 'Phone OTP verification failed',
        error_code: 'OTP_VERIFY_FAILED',
        request_id: requestId,
      });
    }
  });

  // POST /api/v1/auth/register
  app.post('/api/v1/auth/register', async (req: Request, res: Response) => {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ error: 'email, password and name are required' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    try {
      const p = pool;
      if (!p) throw new Error('Database not initialized');
      const existing = await p.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }

      const password_hash = await bcrypt.hash(password, 10);
      const result = await p.query(
        'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, created_at',
        [email.toLowerCase().trim(), password_hash, name.trim()]
      );
      const user = result.rows[0];
      const token = signToken(user.id, user.email);

      res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name } });
    } catch (err) {
      console.error('[auth] register error', err);
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  // POST /api/v1/auth/login
  app.post('/api/v1/auth/login', async (req: Request, res: Response) => {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }

    try {
      const p = pool;
      if (!p) throw new Error('Database not initialized');
      const result = await p.query(
        'SELECT id, email, name, password_hash FROM users WHERE email = $1',
        [email.toLowerCase().trim()]
      );
      const user = result.rows[0];

      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      const token = signToken(user.id, user.email);
      res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
    } catch (err) {
      console.error('[auth] login error', err);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // GET /api/v1/auth/me  (protected)
  app.get('/api/v1/auth/me', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const p = pool;
      if (!p) throw new Error('Database not initialized');
      const result = await p.query(
        'SELECT id, email, name, created_at FROM users WHERE id = $1',
        [req.userId]
      );
      const user = result.rows[0];
      if (!user) { res.status(404).json({ error: 'User not found' }); return; }
      res.json({ user });
    } catch {
      res.status(500).json({ error: 'Failed to get user' });
    }
  });
}
