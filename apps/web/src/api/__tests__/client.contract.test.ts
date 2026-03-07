import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCollection,
  search,
  startSupervisorAgent,
} from '../client';

describe('API workspace_id contract', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('sends workspace_id for search', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [], total: 0, query: 'test', normalizedQuery: 'test', filtersApplied: { type: null, source: null, updatedFrom: null, updatedTo: null, limit: 10 }, facets: { byType: [], bySource: [] }, nextCursor: null, durationMs: 1 }), { status: 200 })
    );

    await search({ q: 'test', workspaceId: 'ws-1' });

    const [, init] = fetchMock.mock.calls[0];
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/search?');
    expect(url).toContain('workspace_id=ws-1');
    expect(url).toContain('q=test');
  });

  it('normalizes createCollection to workspace_id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'c1' }), { status: 200 })
    );

    await createCollection({ workspaceId: 'ws-2', name: 'Roadmap' });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.workspace_id).toBe('ws-2');
  });

  it('sends workspace_id for supervisor agent', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ run_id: 'r1' }), { status: 200 })
    );

    await startSupervisorAgent('hello', 'ws-3', 'auto');

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.workspace_id).toBe('ws-3');
  });
});
