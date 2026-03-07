import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SearchPanel from '../SearchPanel';
import { AppContextProvider, type AppContextValue } from '../../contexts/AppContext';

const clientMocks = vi.hoisted(() => ({
  search: vi.fn(),
  getSearchIndexStatus: vi.fn(),
  reindexSearchDocument: vi.fn(),
}));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    search: clientMocks.search,
    getSearchIndexStatus: clientMocks.getSearchIndexStatus,
    reindexSearchDocument: clientMocks.reindexSearchDocument,
  };
});

function createSearchResponse(overrides: Partial<any> = {}) {
  return {
    items: [
      {
        documentId: 'doc-1',
        blockId: 'block-1',
        title: 'Pricing Spec',
        type: 'spec',
        source: 'manual',
        snippet: 'Pricing Spec v2 now includes annual discounts.',
        highlights: [{ field: 'content', text: '...includes annual discounts...' }],
        matchedFields: ['title', 'content'],
        indexedAt: '2026-03-07T08:00:00.000Z',
        updatedAt: '2026-03-07T08:10:00.000Z',
        isStale: true,
        staleReason: 'document_updated_after_index',
        score: 0.91,
        documentTarget: { surface: 'document', payload: { documentId: 'doc-1' } },
        traceTarget: { surface: 'operations', payload: { jobId: 'job-1', jobType: 'document_reindex' } },
      },
    ],
    total: 1,
    query: 'pricing',
    normalizedQuery: 'pricing',
    filtersApplied: {
      type: null,
      source: null,
      updatedFrom: null,
      updatedTo: null,
      limit: 10,
    },
    facets: {
      byType: [{ value: 'spec', count: 1 }],
      bySource: [{ value: 'manual', count: 1 }],
    },
    nextCursor: null,
    durationMs: 22,
    ...overrides,
  };
}

function renderWithPermissions(canEditDocuments = false) {
  const value: AppContextValue = {
    user: { id: 'user-1' },
    workspace: null,
    workspacePermissions: {
      canViewWorkspace: true,
      canManageMembers: false,
      canManageSettings: false,
      canEditDocuments,
      canDeleteDocuments: canEditDocuments,
      canRunAutomation: false,
      canCollaborate: canEditDocuments,
      canManageAssignments: false,
    },
    workspaceMembershipSummary: null,
    documents: [],
    collections: [],
    activeDoc: null,
    setActiveDoc: vi.fn(),
    handleSelectDoc: vi.fn(),
    handleNewDoc: vi.fn(async () => undefined),
    activeCollection: null,
    setActiveCollection: vi.fn(),
    handleSelectCollection: vi.fn(),
    sidebarOpen: true,
    setSidebarOpen: vi.fn(),
    presentationMode: false,
    setPresentationMode: vi.fn(),
    showTaskModal: false,
    editingItem: null,
    openTaskModal: vi.fn(),
    openEditModal: vi.fn(),
    closeTaskModal: vi.fn(),
    openSurfaceTarget: vi.fn(),
    requestRefresh: vi.fn(),
    refreshVersions: {
      search: 0,
      agentRuns: 0,
      jobs: 0,
      admin: 0,
      audit: 0,
      inbox: 0,
    },
  };

  return render(
    <AppContextProvider value={value}>
      <SearchPanel workspaceId="ws-1" onOpenOperations={vi.fn()} />
    </AppContextProvider>
  );
}

describe('SearchPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMocks.getSearchIndexStatus.mockResolvedValue({
      totalDocuments: 4,
      pendingDocuments: 0,
      indexedDocuments: 3,
      staleDocuments: 1,
      failedDocuments: 0,
      lastIndexedAt: '2026-03-07T08:00:00.000Z',
    });
  });

  it('renders search results and stale badge from the API response', async () => {
    clientMocks.search.mockResolvedValue(createSearchResponse());
    renderWithPermissions(false);

    fireEvent.change(screen.getByPlaceholderText('Search documents, titles, sources, and indexed content'), {
      target: { value: 'pricing' },
    });
    fireEvent.click(screen.getByText('Search'));

    expect(await screen.findByText('Pricing Spec')).toBeInTheDocument();
    expect(screen.getByText('Stale: document updated')).toBeInTheDocument();
    expect(screen.getByText('Normalized query: pricing')).toBeInTheDocument();
  });

  it('renders the no-result recovery state', async () => {
    clientMocks.search.mockResolvedValue(
      createSearchResponse({
        items: [],
        total: 0,
        facets: { byType: [], bySource: [] },
      })
    );
    renderWithPermissions(false);

    fireEvent.change(screen.getByPlaceholderText('Search documents, titles, sources, and indexed content'), {
      target: { value: 'unknown topic' },
    });
    fireEvent.click(screen.getByText('Search'));

    expect(await screen.findByText('No search results')).toBeInTheDocument();
    expect(screen.getByText(/Try a different keyword, remove filters/i)).toBeInTheDocument();
  });

  it('re-queries when filters change', async () => {
    clientMocks.search.mockResolvedValue(createSearchResponse());
    renderWithPermissions(false);

    fireEvent.change(screen.getByPlaceholderText('Search documents, titles, sources, and indexed content'), {
      target: { value: 'pricing' },
    });
    fireEvent.click(screen.getByText('Search'));

    await waitFor(() => {
      expect(clientMocks.search).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByLabelText('Type filter'), { target: { value: 'spec' } });

    await waitFor(() => {
      expect(clientMocks.search).toHaveBeenCalledTimes(2);
    });
    expect(clientMocks.search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        q: 'pricing',
        type: 'spec',
      })
    );
  });

  it('reindexes stale results and refreshes the current query', async () => {
    clientMocks.search.mockResolvedValue(createSearchResponse());
    clientMocks.reindexSearchDocument.mockResolvedValue({
      documentId: 'doc-1',
      jobId: 'job-1',
      status: 'queued',
      indexStatus: 'stale',
    });

    renderWithPermissions(true);

    fireEvent.change(screen.getByPlaceholderText('Search documents, titles, sources, and indexed content'), {
      target: { value: 'pricing' },
    });
    fireEvent.click(screen.getByText('Search'));
    expect(await screen.findByText('Pricing Spec')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Reindex document'));

    await waitFor(() => {
      expect(clientMocks.reindexSearchDocument).toHaveBeenCalledWith('doc-1');
    });
    await waitFor(() => {
      expect(clientMocks.search).toHaveBeenCalledTimes(2);
    });
  });
});
