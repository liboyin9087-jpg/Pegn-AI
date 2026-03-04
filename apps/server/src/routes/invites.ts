import type { Express, Response } from 'express';
import crypto from 'node:crypto';
import { pool } from '../db/client.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { observability } from '../services/observability.js';
import { isFeatureEnabled } from '../services/featureFlags.js';

type InviteRole = 'admin' | 'editor' | 'viewer';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function workspaceIdFromParams(req: AuthRequest): string | undefined {
  return req.params.workspace_id || req.params.workspaceId;
}

async function getGlobalRoleId(roleName: InviteRole): Promise<string | null> {
  const p = pool;
  if (!p) return null;
  const roleResult = await p.query(
    'SELECT id FROM roles WHERE workspace_id IS NULL AND name = $1 LIMIT 1',
    [roleName]
  );
  return roleResult.rows[0]?.id ?? null;
}

export function registerInviteRoutes(app: Express): void {
  const ensureEnabled = (res: Response): boolean => {
    if (isFeatureEnabled('INVITES_V1')) return true;
    res.status(404).json({ error: 'Not found' });
    return false;
  };

  // Create a workspace invite and return a one-time link.
  app.post(
    '/api/v1/workspaces/:workspace_id/invites',
    authMiddleware,
    checkPermission('workspace:admin'),
    async (req: AuthRequest, res: Response) => {
      if (!ensureEnabled(res)) return;
      const p = pool;
      if (!p) {
        res.status(503).json({ error: 'Database not available' });
        return;
      }

      const workspaceId = workspaceIdFromParams(req);
      const email = normalizeEmail(String(req.body?.email ?? ''));
      const role = String(req.body?.role ?? '') as InviteRole;

      if (!workspaceId || !email || !['admin', 'editor', 'viewer'].includes(role)) {
        res.status(400).json({ error: 'workspace_id, email, and role(admin/editor/viewer) are required' });
        return;
      }

      try {
        const existsMember = await p.query(
          `SELECT 1
           FROM workspace_members m
           JOIN users u ON u.id = m.user_id
           WHERE m.workspace_id = $1 AND lower(u.email) = $2
           LIMIT 1`,
          [workspaceId, email]
        );
        if ((existsMember.rowCount ?? 0) > 0) {
          res.status(409).json({ error: 'User is already a workspace member' });
          return;
        }

        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashToken(rawToken);
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await p.query(
          `UPDATE workspace_invites
           SET status = 'revoked', revoked_at = NOW()
           WHERE workspace_id = $1 AND lower(email) = $2 AND status = 'pending'`,
          [workspaceId, email]
        );

        const insert = await p.query(
          `INSERT INTO workspace_invites
           (workspace_id, email, role, token_hash, status, invited_by, expires_at)
           VALUES ($1, $2, $3, $4, 'pending', $5, $6)
           RETURNING id, workspace_id, email, role, status, expires_at, created_at`,
          [workspaceId, email, role, tokenHash, req.userId, expiresAt]
        );

        const frontendBase = process.env.FRONTEND_URL ?? 'http://localhost:5177';
        const inviteLink = `${frontendBase}/invite/${rawToken}`;
        const invite = insert.rows[0];

        observability.info('Workspace invite created', {
          workspaceId,
          inviteId: invite.id,
          email,
          role,
          invitedBy: req.userId
        });

        res.status(201).json({
          invite: {
            ...invite,
            invite_link: inviteLink
          }
        });
      } catch (error) {
        observability.error('Create invite failed', { error, workspaceId, email, role });
        res.status(500).json({ error: 'Failed to create invite' });
      }
    }
  );

  // List invites for workspace admins.
  app.get(
    '/api/v1/workspaces/:workspace_id/invites',
    authMiddleware,
    checkPermission('workspace:admin'),
    async (req: AuthRequest, res: Response) => {
      if (!ensureEnabled(res)) return;
      const p = pool;
      if (!p) {
        res.status(503).json({ error: 'Database not available' });
        return;
      }

      const workspaceId = workspaceIdFromParams(req);
      if (!workspaceId) {
        res.status(400).json({ error: 'workspace_id is required' });
        return;
      }

      try {
        const result = await p.query(
          `SELECT i.id, i.workspace_id, i.email, i.role, i.status, i.expires_at, i.created_at, i.accepted_at, i.revoked_at,
                  u1.email AS invited_by_email,
                  u2.email AS accepted_by_email
           FROM workspace_invites i
           LEFT JOIN users u1 ON u1.id = i.invited_by
           LEFT JOIN users u2 ON u2.id = i.accepted_by
           WHERE i.workspace_id = $1
           ORDER BY i.created_at DESC`,
          [workspaceId]
        );
        res.json({ invites: result.rows });
      } catch (error) {
        observability.error('List invites failed', { error, workspaceId });
        res.status(500).json({ error: 'Failed to list invites' });
      }
    }
  );

  // Revoke an invite.
  app.delete(
    '/api/v1/workspaces/:workspace_id/invites/:invite_id',
    authMiddleware,
    checkPermission('workspace:admin'),
    async (req: AuthRequest, res: Response) => {
      if (!ensureEnabled(res)) return;
      const p = pool;
      if (!p) {
        res.status(503).json({ error: 'Database not available' });
        return;
      }

      const workspaceId = workspaceIdFromParams(req);
      const inviteId = req.params.invite_id;
      if (!workspaceId || !inviteId) {
        res.status(400).json({ error: 'workspace_id and invite_id are required' });
        return;
      }

      try {
        const result = await p.query(
          `UPDATE workspace_invites
           SET status = 'revoked', revoked_at = NOW()
           WHERE id = $1 AND workspace_id = $2 AND status = 'pending'
           RETURNING id`,
          [inviteId, workspaceId]
        );

        if ((result.rowCount ?? 0) === 0) {
          res.status(404).json({ error: 'Pending invite not found' });
          return;
        }

        res.json({ success: true, invite_id: inviteId });
      } catch (error) {
        observability.error('Revoke invite failed', { error, workspaceId, inviteId });
        res.status(500).json({ error: 'Failed to revoke invite' });
      }
    }
  );

  // List members in workspace.
  app.get(
    '/api/v1/workspaces/:workspace_id/members',
    authMiddleware,
    checkPermission('collection:view'),
    async (req: AuthRequest, res: Response) => {
      // Members directory is required by comments/@mention and should not depend on INVITES_V1.
      const p = pool;
      if (!p) {
        res.status(503).json({ error: 'Database not available' });
        return;
      }

      const workspaceId = workspaceIdFromParams(req);
      if (!workspaceId) {
        res.status(400).json({ error: 'workspace_id is required' });
        return;
      }

      try {
        const members = await p.query(
          `SELECT
              m.id,
              m.workspace_id,
              m.user_id,
              u.name,
              u.email,
              COALESCE(r.name, m.role) AS role,
              m.joined_at
           FROM workspace_members m
           JOIN users u ON u.id = m.user_id
           LEFT JOIN roles r ON r.id = m.role_id
           WHERE m.workspace_id = $1
           ORDER BY m.joined_at ASC`,
          [workspaceId]
        );
        res.json({ members: members.rows });
      } catch (error) {
        observability.error('List members failed', { error, workspaceId });
        res.status(500).json({ error: 'Failed to list members' });
      }
    }
  );

  // Accept invite link.
  app.post('/api/v1/invites/:token/accept', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!ensureEnabled(res)) return;
    const p = pool;
    if (!p) {
      res.status(503).json({ error: 'Database not available' });
      return;
    }

    const token = req.params.token;
    if (!token) {
      res.status(400).json({ error: 'Invite token is required' });
      return;
    }
    if (!req.userId || !req.userEmail) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const tokenHash = hashToken(token);

    try {
      const inviteResult = await p.query(
        `SELECT * FROM workspace_invites WHERE token_hash = $1 LIMIT 1`,
        [tokenHash]
      );
      const invite = inviteResult.rows[0];
      if (!invite) {
        res.status(404).json({ error: 'Invite not found' });
        return;
      }

      if (invite.status === 'revoked') {
        res.status(410).json({ error: 'Invite revoked' });
        return;
      }
      if (invite.status === 'accepted') {
        res.status(409).json({ error: 'Invite already accepted' });
        return;
      }
      if (new Date(invite.expires_at).getTime() < Date.now()) {
        await p.query(
          `UPDATE workspace_invites
           SET status = 'expired'
           WHERE id = $1 AND status = 'pending'`,
          [invite.id]
        );
        res.status(410).json({ error: 'Invite expired' });
        return;
      }

      if (normalizeEmail(req.userEmail) !== normalizeEmail(invite.email)) {
        res.status(403).json({ error: 'Invite email does not match current account' });
        return;
      }

      const existingMember = await p.query(
        `SELECT id, role FROM workspace_members
         WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
        [invite.workspace_id, req.userId]
      );

      if ((existingMember.rowCount ?? 0) === 0) {
        const roleId = await getGlobalRoleId(invite.role as InviteRole);
        const legacyRole = invite.role === 'admin' ? 'viewer' : invite.role;

        await p.query(
          `INSERT INTO workspace_members (workspace_id, user_id, role, role_id)
           VALUES ($1, $2, $3, $4)`,
          [invite.workspace_id, req.userId, legacyRole, roleId]
        );
      }

      await p.query(
        `UPDATE workspace_invites
         SET status = 'accepted', accepted_by = $1, accepted_at = NOW()
         WHERE id = $2 AND status = 'pending'`,
        [req.userId, invite.id]
      );

      res.json({
        success: true,
        workspace_id: invite.workspace_id,
        role: invite.role
      });
    } catch (error) {
      observability.error('Accept invite failed', { error, userId: req.userId });
      res.status(500).json({ error: 'Failed to accept invite' });
    }
  });
}
