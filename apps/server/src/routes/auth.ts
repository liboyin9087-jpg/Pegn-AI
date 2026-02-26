import type { Express, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db/client.js';
import { signToken, authMiddleware, type AuthRequest } from '../middleware/auth.js';

export function registerAuthRoutes(app: Express): void {

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
