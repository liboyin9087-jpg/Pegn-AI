import type { Express, Request, Response } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { pool } from '../db/client.js';
import { signToken } from '../middleware/auth.js';

// ── Helper: upsert OAuth user ─────────────────────────────────────────────
async function upsertOAuthUser(
  provider: 'google' | 'github',
  providerId: string,
  email: string,
  name: string,
  avatarUrl?: string,
  accessToken?: string,
): Promise<{ id: string; email: string; name: string }> {
  // 1. Check existing OAuth link
  const existing = await pool!.query(
    'SELECT u.id, u.email, u.name FROM oauth_providers op JOIN users u ON u.id = op.user_id WHERE op.provider = $1 AND op.provider_id = $2',
    [provider, providerId],
  );
  if (existing.rows.length > 0) {
    // Update tokens
    await pool!.query(
      'UPDATE oauth_providers SET access_token=$1, avatar_url=$2, updated_at=NOW() WHERE provider=$3 AND provider_id=$4',
      [accessToken, avatarUrl, provider, providerId],
    );
    return existing.rows[0];
  }

  // 2. Check if email already registered
  const byEmail = await pool!.query(
    'SELECT id, email, name FROM users WHERE email = $1',
    [email.toLowerCase().trim()],
  );
  let userId: string;
  if (byEmail.rows.length > 0) {
    userId = byEmail.rows[0].id;
  } else {
    // 3. Create new user (no password — OAuth only)
    const newUser = await pool!.query(
      'INSERT INTO users (email, name, avatar_url, password_hash) VALUES ($1, $2, $3, NULL) RETURNING id',
      [email.toLowerCase().trim(), name.trim(), avatarUrl],
    );
    userId = newUser.rows[0].id;
  }

  // 4. Create OAuth link
  await pool!.query(
    'INSERT INTO oauth_providers (user_id, provider, provider_id, access_token, avatar_url) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (provider, provider_id) DO UPDATE SET access_token=$4, avatar_url=$5, updated_at=NOW()',
    [userId, provider, providerId, accessToken, avatarUrl],
  );

  const user = await pool!.query(
    'SELECT id, email, name FROM users WHERE id = $1',
    [userId],
  );
  return user.rows[0];
}

// ── Passport setup ────────────────────────────────────────────────────────
function setupPassport() {
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
  const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? '';
  const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? '';
  const BASE_URL = process.env.PUBLIC_URL ?? 'http://localhost:4000';

  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: `${BASE_URL}/api/v1/auth/google/callback`,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value ?? '';
          const name = profile.displayName ?? email.split('@')[0];
          const avatar = profile.photos?.[0]?.value;
          if (!email) return done(new Error('No email from Google'));
          const user = await upsertOAuthUser('google', profile.id, email, name, avatar, _accessToken);
          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      },
    ));
  }

  if (GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET) {
    passport.use(new GitHubStrategy(
      {
        clientID: GITHUB_CLIENT_ID,
        clientSecret: GITHUB_CLIENT_SECRET,
        callbackURL: `${BASE_URL}/api/v1/auth/github/callback`,
        scope: ['user:email'],
      },
      async (_accessToken: string, _refreshToken: string, profile: any, done: any) => {
        try {
          const email = profile.emails?.[0]?.value ?? `${profile.username}@github.com`;
          const name = profile.displayName ?? profile.username ?? email.split('@')[0];
          const avatar = profile.photos?.[0]?.value;
          const user = await upsertOAuthUser('github', profile.id, email, name, avatar, _accessToken);
          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      },
    ));
  }

  passport.serializeUser((user: any, done) => done(null, user));
  passport.deserializeUser((user: any, done) => done(null, user));
}

// ── Register OAuth Routes ─────────────────────────────────────────────────
export function registerOAuthRoutes(app: Express): void {
  const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5177';

  if (!pool) {
    console.warn('[oauth] No database connection, OAuth routes disabled');
    return;
  }

  setupPassport();
  app.use(passport.initialize());

  // Helper: redirect with token to frontend
  function redirectWithToken(res: Response, user: { id: string; email: string; name: string }) {
    const token = signToken(user.id, user.email);
    // Redirect to frontend with token in URL fragment (not query param for security)
    res.redirect(`${FRONTEND_URL}/auth/callback#token=${token}&name=${encodeURIComponent(user.name)}&email=${encodeURIComponent(user.email)}`);
  }

  function oauthError(res: Response, err: any) {
    console.error('[oauth] error', err);
    res.redirect(`${FRONTEND_URL}/auth/callback#error=${encodeURIComponent(err?.message ?? 'OAuth failed')}`);
  }

  // ── Google ──
  app.get('/api/v1/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'], session: false }),
  );
  app.get('/api/v1/auth/google/callback',
    (req, res, next) => {
      passport.authenticate('google', { session: false }, (err: any, user: any) => {
        if (err || !user) return oauthError(res, err ?? new Error('No user'));
        redirectWithToken(res, user);
      })(req, res, next);
    },
  );

  // ── GitHub ──
  app.get('/api/v1/auth/github',
    passport.authenticate('github', { scope: ['user:email'], session: false }),
  );
  app.get('/api/v1/auth/github/callback',
    (req, res, next) => {
      passport.authenticate('github', { session: false }, (err: any, user: any) => {
        if (err || !user) return oauthError(res, err ?? new Error('No user'));
        redirectWithToken(res, user);
      })(req, res, next);
    },
  );

  // ── Status check (are OAuth providers configured?) ──
  app.get('/api/v1/auth/oauth/status', (_req: Request, res: Response) => {
    res.json({
      google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      github: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    });
  });

  console.log('[oauth] routes registered');
}
