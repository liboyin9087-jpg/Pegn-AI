import { describe, expect, it } from 'vitest';
import {
  getDbRequestContext,
  runWithDbRequestContext,
  runWithSystemDbContext,
  updateDbRequestContext,
} from './context.js';

describe('db request context', () => {
  it('stores and updates scoped request context', () => {
    runWithDbRequestContext({ userId: 'user-1', workspaceId: 'ws-1' }, () => {
      expect(getDbRequestContext()).toMatchObject({
        userId: 'user-1',
        workspaceId: 'ws-1',
        bypassRls: false,
      });

      updateDbRequestContext({ workspaceId: 'ws-2' });

      expect(getDbRequestContext()).toMatchObject({
        userId: 'user-1',
        workspaceId: 'ws-2',
        bypassRls: false,
      });
    });
  });

  it('marks system scopes as bypassing rls', () => {
    runWithSystemDbContext({ workspaceId: 'ws-1', userId: 'system-user' }, () => {
      expect(getDbRequestContext()).toMatchObject({
        workspaceId: 'ws-1',
        userId: 'system-user',
        bypassRls: true,
      });
    });
  });
});
