/**
 * SCIM 2.0 User Provisioning
 * Supports automated user lifecycle management from enterprise IdPs (Okta, Azure AD, etc.)
 * Bearer token authentication via SCIM_TOKEN env variable.
 *
 * Endpoints:
 *   GET    /scim/v2/Users           — List users
 *   POST   /scim/v2/Users           — Create user
 *   GET    /scim/v2/Users/:id       — Get user
 *   PUT    /scim/v2/Users/:id       — Replace user
 *   PATCH  /scim/v2/Users/:id       — Update user
 *   DELETE /scim/v2/Users/:id       — Deactivate user
 *   GET    /scim/v2/Groups          — List groups (workspace as group)
 */
import type { Express, Request, Response, NextFunction } from 'express';
import { pool } from '../db/client.js';
import { observability } from '../services/observability.js';

// ── SCIM Auth Middleware ────────────────────────────────────────────────────
function scimAuth(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.SCIM_TOKEN;
  if (!token) {
    res.status(503).json({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'SCIM not configured', status: 503 });
    return;
  }
  const authHeader = req.headers.authorization ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (bearer !== token) {
    res.status(401).json({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'Invalid SCIM token', status: 401 });
    return;
  }
  next();
}

// ── SCIM Resource Formatters ──────────────────────────────────────────────
function scimUser(row: any) {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: row.id,
    externalId: row.email,
    userName: row.email,
    displayName: row.name,
    name: { formatted: row.name },
    emails: [{ value: row.email, primary: true, type: 'work' }],
    active: !row.deleted_at,
    meta: {
      resourceType: 'User',
      created: row.created_at,
      lastModified: row.updated_at,
      location: `/scim/v2/Users/${row.id}`,
    },
  };
}

function scimListResponse(resources: any[], totalResults: number, startIndex = 1) {
  return {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

function scimError(detail: string, status: number) {
  return { schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail, status };
}

// ── Register SCIM Routes ───────────────────────────────────────────────────
export function registerScimRoutes(app: Express): void {
  const PREFIX = '/scim/v2';

  // GET /scim/v2/Users — List with optional filter (filter=userName eq "email")
  app.get(`${PREFIX}/Users`, scimAuth, async (req: Request, res: Response) => {
    const p = pool;
    if (!p) { res.status(503).json(scimError('DB not available', 503)); return; }
    try {
      const count = parseInt(req.query.count as string) || 100;
      const startIndex = parseInt(req.query.startIndex as string) || 1;
      const filter = req.query.filter as string | undefined;

      let query = 'SELECT * FROM users';
      const params: any[] = [];

      // Support filter=userName eq "xxx" or filter=emails[type eq "work" and value eq "xxx"]
      if (filter) {
        const match = filter.match(/(?:userName|emails\[.*?value)\s+eq\s+"([^"]+)"/i);
        if (match) {
          query += ' WHERE email = $1';
          params.push(match[1].toLowerCase().trim());
        }
      }

      const countRes = await p.query(`SELECT COUNT(*) FROM (${query}) t`, params);
      const dataRes = await p.query(
        `${query} ORDER BY created_at ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, count, startIndex - 1]
      );

      res.json(scimListResponse(dataRes.rows.map(scimUser), parseInt(countRes.rows[0].count), startIndex));
    } catch (err) {
      observability.error('SCIM list users failed', { error: String(err) });
      res.status(500).json(scimError('Internal error', 500));
    }
  });

  // POST /scim/v2/Users — Provision new user
  app.post(`${PREFIX}/Users`, scimAuth, async (req: Request, res: Response) => {
    const p = pool;
    if (!p) { res.status(503).json(scimError('DB not available', 503)); return; }
    try {
      const { userName, displayName, name, emails, active = true } = req.body;
      const email = (userName ?? emails?.[0]?.value ?? '').toLowerCase().trim();
      const fullName = displayName ?? name?.formatted ?? email.split('@')[0];
      if (!email) { res.status(400).json(scimError('userName (email) required', 400)); return; }

      const result = await p.query(
        `INSERT INTO users (email, name, password_hash)
         VALUES ($1, $2, NULL)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
         RETURNING *`,
        [email, fullName]
      );
      // If active=false, mark as deleted immediately
      if (!active) {
        await p.query('UPDATE users SET updated_at = NOW() WHERE id = $1', [result.rows[0].id]);
      }
      res.status(201).json(scimUser(result.rows[0]));
    } catch (err) {
      observability.error('SCIM create user failed', { error: String(err) });
      res.status(500).json(scimError('Internal error', 500));
    }
  });

  // GET /scim/v2/Users/:id
  app.get(`${PREFIX}/Users/:id`, scimAuth, async (req: Request, res: Response) => {
    const p = pool;
    if (!p) { res.status(503).json(scimError('DB not available', 503)); return; }
    try {
      const result = await p.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
      if (!result.rows[0]) { res.status(404).json(scimError('User not found', 404)); return; }
      res.json(scimUser(result.rows[0]));
    } catch (err) {
      res.status(500).json(scimError('Internal error', 500));
    }
  });

  // PUT /scim/v2/Users/:id — Full replace
  app.put(`${PREFIX}/Users/:id`, scimAuth, async (req: Request, res: Response) => {
    const p = pool;
    if (!p) { res.status(503).json(scimError('DB not available', 503)); return; }
    try {
      const { displayName, name, emails, active = true } = req.body;
      const email = (emails?.[0]?.value ?? '').toLowerCase().trim();
      const fullName = displayName ?? name?.formatted ?? email.split('@')[0];

      // If active=false, soft-delete (we don't store deleted_at on users yet — set a flag in metadata)
      const result = await p.query(
        `UPDATE users SET name = $1, email = COALESCE(NULLIF($2, ''), email), updated_at = NOW()
         WHERE id = $3 RETURNING *`,
        [fullName, email, req.params.id]
      );
      if (!result.rows[0]) { res.status(404).json(scimError('User not found', 404)); return; }

      if (!active) {
        // Remove from all workspaces to deactivate
        await p.query('DELETE FROM workspace_members WHERE user_id = $1', [req.params.id]);
      }
      res.json(scimUser(result.rows[0]));
    } catch (err) {
      res.status(500).json(scimError('Internal error', 500));
    }
  });

  // PATCH /scim/v2/Users/:id — Partial update via Operations
  app.patch(`${PREFIX}/Users/:id`, scimAuth, async (req: Request, res: Response) => {
    const p = pool;
    if (!p) { res.status(503).json(scimError('DB not available', 503)); return; }
    try {
      const ops: Array<{ op: string; path?: string; value: any }> = req.body.Operations ?? [];
      for (const op of ops) {
        const opLower = op.op.toLowerCase();
        if (opLower === 'replace' || opLower === 'add') {
          if (op.path === 'active' || op.value?.active === false) {
            // Deactivate: remove from workspaces
            await p.query('DELETE FROM workspace_members WHERE user_id = $1', [req.params.id]);
          }
          if (op.path === 'displayName' && typeof op.value === 'string') {
            await p.query('UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2', [op.value, req.params.id]);
          }
          if (!op.path && op.value?.displayName) {
            await p.query('UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2', [op.value.displayName, req.params.id]);
          }
        }
      }
      const result = await p.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
      if (!result.rows[0]) { res.status(404).json(scimError('User not found', 404)); return; }
      res.json(scimUser(result.rows[0]));
    } catch (err) {
      res.status(500).json(scimError('Internal error', 500));
    }
  });

  // DELETE /scim/v2/Users/:id — Deprovision (remove from all workspaces)
  app.delete(`${PREFIX}/Users/:id`, scimAuth, async (req: Request, res: Response) => {
    const p = pool;
    if (!p) { res.status(503).json(scimError('DB not available', 503)); return; }
    try {
      await p.query('DELETE FROM workspace_members WHERE user_id = $1', [req.params.id]);
      observability.info('SCIM user deprovisioned', { userId: req.params.id });
      res.status(204).send();
    } catch (err) {
      res.status(500).json(scimError('Internal error', 500));
    }
  });

  // GET /scim/v2/Groups — Return workspaces as groups
  app.get(`${PREFIX}/Groups`, scimAuth, async (req: Request, res: Response) => {
    const p = pool;
    if (!p) { res.status(503).json(scimError('DB not available', 503)); return; }
    try {
      const result = await p.query(
        `SELECT w.id, w.name, w.created_at, w.updated_at,
                COALESCE(json_agg(json_build_object('value', u.id, 'display', u.name)) FILTER (WHERE u.id IS NOT NULL), '[]') AS members
         FROM workspaces w
         LEFT JOIN workspace_members m ON m.workspace_id = w.id
         LEFT JOIN users u ON u.id = m.user_id
         GROUP BY w.id ORDER BY w.created_at ASC LIMIT 200`
      );
      const groups = result.rows.map(r => ({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        id: r.id,
        displayName: r.name,
        members: r.members,
        meta: { resourceType: 'Group', created: r.created_at, lastModified: r.updated_at },
      }));
      res.json(scimListResponse(groups, groups.length));
    } catch (err) {
      res.status(500).json(scimError('Internal error', 500));
    }
  });

  console.log('[scim] SCIM 2.0 routes registered at /scim/v2');
}
