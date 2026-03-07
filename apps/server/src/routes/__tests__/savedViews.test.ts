import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signToken } from '../../middleware/auth.js';

const mockPool = { query: vi.fn() };
const serviceMocks = vi.hoisted(() => ({
  listSavedViews: vi.fn(),
  getSavedView: vi.fn(),
  createSavedView: vi.fn(),
  updateSavedView: vi.fn(),
  deleteSavedView: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({ pool: mockPool }));
vi.mock('../../services/savedViews.js', () => serviceMocks);

type Role = 'admin' | 'editor' | 'viewer';

function setupMembership(role: Role) {
  mockPool.query.mockImplementation(async (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.includes('from workspace_members m') && normalized.includes('left join roles r')) {
      return {
        rows: [{
          user_id: 'user-1',
          workspace_id: 'ws-1',
          legacy_role: role === 'admin' ? 'owner' : role,
          role_name: role === 'admin' ? 'admin' : role,
          permissions: JSON.stringify([]),
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
}

async function createApp() {
  const { registerSavedViewRoutes } = await import('../savedViews.js');
  const app = express();
  app.use(express.json());
  registerSavedViewRoutes(app);
  return app;
}

describe('saved view routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.listSavedViews.mockResolvedValue({ items: [] });
    serviceMocks.getSavedView.mockResolvedValue({
      id: 'view-1',
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      scope: 'personal',
      surface: 'search',
      name: 'Saved search',
      description: null,
      contextVersion: 1,
      payload: { query: 'alpha' },
      isPinned: false,
      isDefault: false,
      createdAt: '2026-03-07T12:00:00.000Z',
      updatedAt: '2026-03-07T12:00:00.000Z',
    });
    serviceMocks.createSavedView.mockResolvedValue({
      id: 'view-1',
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      scope: 'personal',
      surface: 'search',
      name: 'Saved search',
      description: null,
      contextVersion: 1,
      payload: { query: 'alpha' },
      isPinned: false,
      isDefault: false,
      createdAt: '2026-03-07T12:00:00.000Z',
      updatedAt: '2026-03-07T12:00:00.000Z',
    });
    serviceMocks.updateSavedView.mockResolvedValue({
      id: 'view-1',
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      scope: 'personal',
      surface: 'search',
      name: 'Saved search',
      description: 'updated',
      contextVersion: 1,
      payload: { query: 'alpha' },
      isPinned: true,
      isDefault: true,
      createdAt: '2026-03-07T12:00:00.000Z',
      updatedAt: '2026-03-07T12:10:00.000Z',
    });
    serviceMocks.deleteSavedView.mockResolvedValue(true);
  });

  it('allows viewer to list saved views', async () => {
    setupMembership('viewer');
    const app = await createApp();
    const token = signToken('user-1', 'viewer@example.com');

    const response = await request(app)
      .get('/api/v1/workspaces/ws-1/saved-views?surface=search')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(serviceMocks.listSavedViews).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'user-1',
      surface: 'search',
      scope: null,
      includePinned: false,
    });
  });

  it('returns detail with contextVersion', async () => {
    setupMembership('viewer');
    const app = await createApp();
    const token = signToken('user-1', 'viewer@example.com');

    const response = await request(app)
      .get('/api/v1/workspaces/ws-1/saved-views/view-1')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.contextVersion).toBe(1);
  });

  it('creates a workspace saved view for admin', async () => {
    setupMembership('admin');
    const app = await createApp();
    const token = signToken('user-1', 'admin@example.com');

    const response = await request(app)
      .post('/api/v1/workspaces/ws-1/saved-views')
      .set('Authorization', `Bearer ${token}`)
      .send({
        scope: 'workspace',
        surface: 'search',
        name: 'Shared search',
        contextVersion: 1,
        payload: { query: 'alpha' },
        isPinned: true,
      });

    expect(response.status).toBe(201);
    expect(serviceMocks.createSavedView).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      scope: 'workspace',
      surface: 'search',
      contextVersion: 1,
      canManageWorkspaceViews: true,
    }));
  });

  it('passes personal create for viewer without workspace mutate permission', async () => {
    setupMembership('viewer');
    const app = await createApp();
    const token = signToken('user-1', 'viewer@example.com');

    const response = await request(app)
      .post('/api/v1/workspaces/ws-1/saved-views')
      .set('Authorization', `Bearer ${token}`)
      .send({
        scope: 'personal',
        surface: 'search',
        name: 'My search',
        contextVersion: 1,
        payload: { query: 'alpha' },
      });

    expect(response.status).toBe(201);
    expect(serviceMocks.createSavedView).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'personal',
      canManageWorkspaceViews: false,
    }));
  });

  it('returns 400 for invalid payload errors', async () => {
    setupMembership('admin');
    serviceMocks.createSavedView.mockRejectedValue(new Error('Invalid search updatedRange'));
    const app = await createApp();
    const token = signToken('user-1', 'admin@example.com');

    const response = await request(app)
      .post('/api/v1/workspaces/ws-1/saved-views')
      .set('Authorization', `Bearer ${token}`)
      .send({
        scope: 'workspace',
        surface: 'search',
        name: 'Broken',
        contextVersion: 1,
        payload: { updatedRange: '90d' },
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('BAD_REQUEST');
  });

  it('returns 404 when deleting a missing saved view', async () => {
    setupMembership('admin');
    serviceMocks.deleteSavedView.mockResolvedValue(false);
    const app = await createApp();
    const token = signToken('user-1', 'admin@example.com');

    const response = await request(app)
      .delete('/api/v1/workspaces/ws-1/saved-views/view-missing')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
  });
});
