import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../../db/client.js', () => ({ pool: mockPool }));

import {
  createSavedView,
  deleteSavedView,
  getSavedView,
  listSavedViews,
  updateSavedView,
} from '../savedViews.js';

type SavedViewRow = {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  scope: 'personal' | 'workspace';
  surface: 'search' | 'operations' | 'agent' | 'inbox' | 'admin';
  name: string;
  description: string | null;
  context_version: number;
  payload: Record<string, unknown>;
  is_pinned: boolean;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
};

let rows: SavedViewRow[] = [];
let nextId = 1;

function makeRow(overrides: Partial<SavedViewRow> = {}): SavedViewRow {
  const now = new Date('2026-03-07T12:00:00.000Z');
  return {
    id: `view-${nextId++}`,
    workspace_id: 'ws-1',
    owner_user_id: 'user-1',
    scope: 'personal',
    surface: 'search',
    name: 'Saved search',
    description: null,
    context_version: 1,
    payload: { query: 'alpha', updatedRange: 'all', filters: {} },
    is_pinned: false,
    is_default: false,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function cloneRow(row: SavedViewRow): SavedViewRow {
  return {
    ...row,
    payload: JSON.parse(JSON.stringify(row.payload)),
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

beforeEach(() => {
  rows = [];
  nextId = 1;
  vi.clearAllMocks();

  mockPool.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.startsWith('select * from saved_views where id = $1 and workspace_id = $2 limit 1')) {
      const [viewId, workspaceId] = params as [string, string];
      const row = rows.find((item) => item.id === viewId && item.workspace_id === workspaceId);
      return { rows: row ? [cloneRow(row)] : [], rowCount: row ? 1 : 0 };
    }

    if (normalized.startsWith('select * from saved_views where id = $1 and workspace_id = $2 and (scope = \'workspace\' or owner_user_id = $3)')) {
      const [viewId, workspaceId, userId] = params as [string, string, string];
      const row = rows.find((item) => (
        item.id === viewId
        && item.workspace_id === workspaceId
        && (item.scope === 'workspace' || item.owner_user_id === userId)
      ));
      return { rows: row ? [cloneRow(row)] : [], rowCount: row ? 1 : 0 };
    }

    if (normalized.startsWith('select * from saved_views where')) {
      const [workspaceId, userId, maybeSurface, maybeScope] = params as [string, string, string?, string?];
      let result = rows.filter((item) => item.workspace_id === workspaceId && (item.scope === 'workspace' || item.owner_user_id === userId));
      if (normalized.includes('surface = $3') && maybeSurface) {
        result = result.filter((item) => item.surface === maybeSurface);
      }
      if (normalized.includes('scope = $4') && maybeScope) {
        result = result.filter((item) => item.scope === maybeScope);
      }
      if (normalized.includes('is_pinned = true')) {
        result = result.filter((item) => item.is_pinned);
      }
      result = [...result].sort((a, b) => {
        if (a.is_pinned !== b.is_pinned) return Number(b.is_pinned) - Number(a.is_pinned);
        if (a.scope !== b.scope) return a.scope === 'personal' ? -1 : 1;
        if (a.updated_at.getTime() !== b.updated_at.getTime()) return b.updated_at.getTime() - a.updated_at.getTime();
        return b.id.localeCompare(a.id);
      });
      return { rows: result.map(cloneRow), rowCount: result.length };
    }

    if (normalized.startsWith('update saved_views set is_default = false where workspace_id = $1 and owner_user_id = $2 and surface = $3')) {
      const [workspaceId, ownerUserId, surface, excludedViewId] = params as [string, string, SavedViewRow['surface'], string?];
      rows = rows.map((item) => (
        item.workspace_id === workspaceId
        && item.owner_user_id === ownerUserId
        && item.surface === surface
        && (!excludedViewId || item.id !== excludedViewId)
          ? { ...item, is_default: false, updated_at: new Date('2026-03-07T12:10:00.000Z') }
          : item
      ));
      return { rows: [], rowCount: 0 };
    }

    if (normalized.startsWith('insert into saved_views')) {
      const [
        workspaceId,
        ownerUserId,
        scope,
        surface,
        name,
        description,
        contextVersion,
        payload,
        isPinned,
        isDefault,
      ] = params as [string, string, SavedViewRow['scope'], SavedViewRow['surface'], string, string | null, number, string, boolean, boolean];
      const row = makeRow({
        workspace_id: workspaceId,
        owner_user_id: ownerUserId,
        scope,
        surface,
        name,
        description,
        context_version: contextVersion,
        payload: JSON.parse(payload),
        is_pinned: isPinned,
        is_default: isDefault,
      });
      rows.push(row);
      return { rows: [cloneRow(row)], rowCount: 1 };
    }

    if (normalized.startsWith('update saved_views set name = $3')) {
      const [viewId, workspaceId, name, description, contextVersion, payload, isPinned, isDefault] = params as [
        string,
        string,
        string,
        string | null,
        number,
        string,
        boolean,
        boolean,
      ];
      const index = rows.findIndex((item) => item.id === viewId && item.workspace_id === workspaceId);
      if (index === -1) return { rows: [], rowCount: 0 };
      rows[index] = {
        ...rows[index],
        name,
        description,
        context_version: contextVersion,
        payload: JSON.parse(payload),
        is_pinned: isPinned,
        is_default: isDefault,
        updated_at: new Date('2026-03-07T12:20:00.000Z'),
      };
      return { rows: [cloneRow(rows[index])], rowCount: 1 };
    }

    if (normalized.startsWith('delete from saved_views where id = $1 and workspace_id = $2')) {
      const [viewId, workspaceId] = params as [string, string];
      rows = rows.filter((item) => !(item.id === viewId && item.workspace_id === workspaceId));
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unhandled SQL in test: ${normalized}`);
  });
});

describe('savedViews service', () => {
  it('creates a saved view with contextVersion=1 when omitted', async () => {
    const created = await createSavedView({
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      scope: 'personal',
      surface: 'search',
      name: 'Research queue',
      payload: { query: 'alpha', updatedRange: '7d' },
      isPinned: true,
      isDefault: true,
      canManageWorkspaceViews: false,
    });

    expect(created.contextVersion).toBe(1);
    expect(created.isPinned).toBe(true);
    expect(created.isDefault).toBe(true);
    expect(created.payload).toMatchObject({ query: 'alpha', updatedRange: '7d' });
  });

  it('keeps only one default view per user/workspace/surface', async () => {
    await createSavedView({
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      scope: 'personal',
      surface: 'search',
      name: 'First',
      payload: { query: 'alpha' },
      isDefault: true,
      canManageWorkspaceViews: false,
    });

    const second = await createSavedView({
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      scope: 'personal',
      surface: 'search',
      name: 'Second',
      payload: { query: 'beta' },
      isDefault: true,
      canManageWorkspaceViews: false,
    });

    const listed = await listSavedViews({ workspaceId: 'ws-1', userId: 'user-1', surface: 'search' });
    expect(second.isDefault).toBe(true);
    expect(listed.items.filter((item) => item.isDefault)).toHaveLength(1);
    expect(listed.items.find((item) => item.isDefault)?.name).toBe('Second');
  });

  it('rejects invalid payloads', async () => {
    await expect(createSavedView({
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      scope: 'personal',
      surface: 'search',
      name: 'Broken',
      payload: { updatedRange: '90d' },
      canManageWorkspaceViews: false,
    })).rejects.toThrow('Invalid search updatedRange');
  });

  it('blocks workspace views without manage permission', async () => {
    await expect(createSavedView({
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      scope: 'workspace',
      surface: 'search',
      name: 'Shared',
      payload: { query: 'alpha' },
      canManageWorkspaceViews: false,
    })).rejects.toThrow('FORBIDDEN');
  });

  it('updates and deletes owner personal views', async () => {
    const created = await createSavedView({
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      scope: 'personal',
      surface: 'agent',
      name: 'Run failures',
      payload: { showFailuresOnly: true },
      canManageWorkspaceViews: false,
    });

    const updated = await updateSavedView({
      workspaceId: 'ws-1',
      viewId: created.id,
      userId: 'user-1',
      name: 'Run failures updated',
      contextVersion: 1,
      payload: { showFailuresOnly: true, detailOpen: true },
      isPinned: true,
      isDefault: true,
      canManageWorkspaceViews: false,
    });

    expect(updated?.name).toBe('Run failures updated');
    expect(updated?.isPinned).toBe(true);
    expect(updated?.payload).toMatchObject({ showFailuresOnly: true, detailOpen: true });

    const deleted = await deleteSavedView({
      workspaceId: 'ws-1',
      viewId: created.id,
      userId: 'user-1',
      canManageWorkspaceViews: false,
    });
    expect(deleted).toBe(true);

    const fetched = await getSavedView('ws-1', created.id, 'user-1');
    expect(fetched).toBeNull();
  });
});
