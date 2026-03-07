import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OperationsPanel from '../OperationsPanel';
import { AppContextProvider, type AppContextValue } from '../../contexts/AppContext';

const clientMocks = vi.hoisted(() => ({
  listWorkspaceJobs: vi.fn(),
  getWorkspaceJobSummary: vi.fn(),
  getWorkspaceJob: vi.fn(),
  getWorkspaceJobEvents: vi.fn(),
  retryWorkspaceJob: vi.fn(),
  cancelWorkspaceJob: vi.fn(),
}));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    ...clientMocks,
  };
});

const baseContext: AppContextValue = {
  user: null,
  workspace: null,
  workspacePermissions: {
    canViewWorkspace: true,
    canManageMembers: false,
    canManageSettings: false,
    canEditDocuments: true,
    canDeleteDocuments: true,
    canRunAutomation: true,
  },
  workspaceMembershipSummary: null,
  documents: [],
  collections: [],
  activeDoc: null,
  setActiveDoc: vi.fn(),
  handleSelectDoc: vi.fn(),
  handleNewDoc: vi.fn(),
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

function renderPanel(permissions = baseContext.workspacePermissions) {
  return render(
    <AppContextProvider value={{ ...baseContext, workspacePermissions: permissions }}>
      <OperationsPanel workspaceId="ws-1" />
    </AppContextProvider>
  );
}

describe('OperationsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMocks.getWorkspaceJobSummary.mockResolvedValue({
      total: 2,
      queued: 0,
      running: 1,
      succeeded: 0,
      failed: 1,
      cancelled: 0,
      timeout: 0,
      byType: {
        document_index: 0,
        document_reindex: 1,
        agent_run: 1,
        automation_trigger: 0,
      },
      latestFailedAt: '2026-03-07T10:00:10.000Z',
    });
    clientMocks.listWorkspaceJobs.mockResolvedValue({
      items: [
        {
          id: 'job-1',
          workspaceId: 'ws-1',
          jobType: 'agent_run',
          resourceType: 'agent_run',
          resourceId: 'run-1',
          sourceDomain: 'agent',
          sourceRunId: 'run-1',
          triggeredBy: 'user-1',
          triggeredVia: 'manual',
          status: 'failed',
          errorCode: 'runtime_error',
          errorSummary: 'Model timeout',
          createdAt: '2026-03-07T10:00:00.000Z',
          updatedAt: '2026-03-07T10:00:10.000Z',
          startedAt: '2026-03-07T10:00:01.000Z',
          finishedAt: '2026-03-07T10:00:10.000Z',
          retryOfJobId: null,
          cancelRequestedAt: null,
          metadata: {},
        },
      ],
      nextCursor: null,
    });
    clientMocks.getWorkspaceJob.mockResolvedValue({
      id: 'job-1',
      workspaceId: 'ws-1',
      jobType: 'agent_run',
      resourceType: 'agent_run',
      resourceId: 'run-1',
      sourceDomain: 'agent',
      sourceRunId: 'run-1',
      triggeredBy: 'user-1',
      triggeredVia: 'manual',
      status: 'failed',
      errorCode: 'runtime_error',
      errorSummary: 'Model timeout',
      createdAt: '2026-03-07T10:00:00.000Z',
      updatedAt: '2026-03-07T10:00:10.000Z',
      startedAt: '2026-03-07T10:00:01.000Z',
      finishedAt: '2026-03-07T10:00:10.000Z',
      retryOfJobId: null,
      cancelRequestedAt: null,
      metadata: {},
    });
    clientMocks.getWorkspaceJobEvents.mockResolvedValue({
      items: [
        {
          id: 'evt-1',
          jobId: 'job-1',
          sequenceNo: 1,
          eventType: 'failed',
          message: 'Model timeout',
          payload: {},
          createdAt: '2026-03-07T10:00:10.000Z',
        },
      ],
    });
  });

  it('loads summary and jobs list on mount', async () => {
    renderPanel();

    await waitFor(() => {
      expect(clientMocks.getWorkspaceJobSummary).toHaveBeenCalledWith('ws-1');
      expect(clientMocks.listWorkspaceJobs).toHaveBeenCalledWith('ws-1', expect.any(Object));
    });
    expect(await screen.findByText('Recent failed jobs')).toBeInTheDocument();
  });

  it('updates the list when failed status filter is selected', async () => {
    renderPanel();

    await screen.findByText('agent_run');
    fireEvent.click(screen.getByText('Failed'));

    await waitFor(() => {
      expect(clientMocks.listWorkspaceJobs).toHaveBeenLastCalledWith('ws-1', expect.objectContaining({
        status: 'failed',
      }));
    });
  });

  it('loads detail and timeline for a selected job', async () => {
    renderPanel();

    fireEvent.click(await screen.findByText('agent_run'));

    await waitFor(() => {
      expect(clientMocks.getWorkspaceJob).toHaveBeenCalledWith('ws-1', 'job-1');
      expect(clientMocks.getWorkspaceJobEvents).toHaveBeenCalledWith('ws-1', 'job-1');
    });
    expect((await screen.findAllByText('Model timeout')).length).toBeGreaterThan(0);
  });

  it('hides retry and cancel actions from read-only viewers', async () => {
    renderPanel({
      canViewWorkspace: true,
      canManageMembers: false,
      canManageSettings: false,
      canEditDocuments: false,
      canDeleteDocuments: false,
      canRunAutomation: false,
    });

    await screen.findByText('agent_run');
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });
});
