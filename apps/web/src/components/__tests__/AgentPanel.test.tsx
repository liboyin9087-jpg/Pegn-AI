import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AgentPanel from '../AgentPanel';
import type { WorkspaceMembershipSummary } from '../../api/client';

const clientMocks = vi.hoisted(() => ({
  createAgentRun: vi.fn(),
  getAgentRun: vi.fn(),
  rerunAgentRun: vi.fn(),
  listAgentRuns: vi.fn(),
  streamAgentRun: vi.fn(),
  api: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  ...clientMocks,
}));

function makeRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'run-1',
    runId: 'run-1',
    workspaceId: 'ws-1',
    userId: 'user-1',
    type: 'research',
    title: 'Research',
    mode: 'auto',
    status: 'queued',
    input: 'Investigate roadmap',
    inputSummary: 'Investigate roadmap',
    output: null,
    outputSummary: null,
    errorSummary: null,
    promptVersion: 'v1',
    promptLabel: 'research',
    templateId: 'research',
    templateVersion: 'v1',
    createdAt: '2026-03-07T10:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    rerunOfRunId: null,
    depth: 0,
    result: null,
    citations: [],
    relatedArtifacts: [],
    steps: [],
    ...overrides,
  };
}

const adminMembership: WorkspaceMembershipSummary = {
  effectiveRole: 'admin',
  permissions: ['workspace:read', 'agent:run', 'automation:trigger'],
  permissionSummary: {
    canViewWorkspace: true,
    canManageMembers: true,
    canManageSettings: true,
    canEditDocuments: true,
    canDeleteDocuments: true,
    canRunAutomation: true,
    canCollaborate: true,
    canManageAssignments: true,
  },
};

const viewerMembership: WorkspaceMembershipSummary = {
  effectiveRole: 'viewer',
  permissions: ['workspace:read'],
  permissionSummary: {
    canViewWorkspace: true,
    canManageMembers: false,
    canManageSettings: false,
    canEditDocuments: false,
    canDeleteDocuments: false,
    canRunAutomation: false,
    canCollaborate: false,
    canManageAssignments: false,
  },
};

describe('AgentPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    clientMocks.listAgentRuns.mockResolvedValue({ items: [], nextCursor: null });
    clientMocks.api.mockResolvedValue({});
    clientMocks.streamAgentRun.mockImplementation((_runId, _wsId, onData, onDone) => {
      setTimeout(() => {
        onData({
          type: 'run',
          run: makeRun({
            status: 'completed',
            outputSummary: 'Final answer',
            result: { answer: 'Final answer' },
          }),
        });
        onDone();
      }, 0);
      return () => {};
    });
  });

  it('creates a run before attaching the stream', async () => {
    clientMocks.createAgentRun.mockResolvedValue(makeRun());
    clientMocks.getAgentRun.mockResolvedValue(makeRun({ status: 'running' }));

    render(<AgentPanel workspaceId="ws-1" activeDoc={null} workspaceMembershipSummary={adminMembership} />);

    fireEvent.change(screen.getByPlaceholderText('Ask the agent to investigate a topic...'), {
      target: { value: 'Investigate roadmap' },
    });
    fireEvent.click(screen.getByText('Run'));

    await waitFor(() => {
      expect(clientMocks.createAgentRun).toHaveBeenCalledWith('Investigate roadmap', 'ws-1', {
        mode: 'auto',
        template: 'research',
      });
    });
    await waitFor(() => {
      expect(clientMocks.streamAgentRun).toHaveBeenCalledWith('run-1', 'ws-1', expect.any(Function), expect.any(Function), expect.any(Function));
    });
  });

  it('renders completed state from stream snapshots', async () => {
    clientMocks.createAgentRun.mockResolvedValue(makeRun());
    clientMocks.getAgentRun
      .mockResolvedValueOnce(makeRun({ status: 'running' }))
      .mockResolvedValueOnce(makeRun({
        status: 'completed',
        outputSummary: 'Final answer',
        result: { answer: 'Final answer' },
      }));

    render(<AgentPanel workspaceId="ws-1" activeDoc={null} workspaceMembershipSummary={adminMembership} />);

    fireEvent.change(screen.getByPlaceholderText('Ask the agent to investigate a topic...'), {
      target: { value: 'Investigate roadmap' },
    });
    fireEvent.click(screen.getByText('Run'));

    expect((await screen.findAllByText('Final answer')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Final Output')).toBeInTheDocument();
  });

  it('renders failed state and retries as a new run', async () => {
    clientMocks.createAgentRun.mockResolvedValueOnce(makeRun({ id: 'run-failed', runId: 'run-failed' }));
    clientMocks.rerunAgentRun.mockResolvedValueOnce({
      runId: 'run-retry',
      jobId: 'job-retry',
      status: 'queued',
      rerunOfRunId: 'run-failed',
    });
    clientMocks.getAgentRun
      .mockResolvedValueOnce(makeRun({ id: 'run-failed', runId: 'run-failed', status: 'running' }))
      .mockResolvedValueOnce(makeRun({ id: 'run-failed', runId: 'run-failed', status: 'failed', errorSummary: 'Model unavailable' }))
      .mockResolvedValueOnce(makeRun({ id: 'run-retry', status: 'running' }))
      .mockResolvedValueOnce(makeRun({
        id: 'run-retry',
        runId: 'run-retry',
        status: 'completed',
        outputSummary: 'Recovered answer',
        output: 'Recovered answer',
        result: { answer: 'Recovered answer' },
        rerunOfRunId: 'run-failed',
      }));
    clientMocks.streamAgentRun
      .mockImplementationOnce((_runId, _wsId, onData, onDone) => {
        setTimeout(() => {
          onData({
            type: 'run',
            run: makeRun({
              id: 'run-failed',
              runId: 'run-failed',
              status: 'failed',
              errorSummary: 'Model unavailable',
            }),
          });
          onDone();
        }, 0);
        return () => {};
      })
      .mockImplementationOnce((_runId, _wsId, onData, onDone) => {
        setTimeout(() => {
          onData({
            type: 'run',
            run: makeRun({
              id: 'run-retry',
              runId: 'run-retry',
              status: 'completed',
              outputSummary: 'Recovered answer',
              output: 'Recovered answer',
              result: { answer: 'Recovered answer' },
              rerunOfRunId: 'run-failed',
            }),
          });
          onDone();
        }, 0);
        return () => {};
      });

    render(<AgentPanel workspaceId="ws-1" activeDoc={null} workspaceMembershipSummary={adminMembership} />);

    fireEvent.change(screen.getByPlaceholderText('Ask the agent to investigate a topic...'), {
      target: { value: 'Investigate roadmap' },
    });
    fireEvent.click(screen.getByText('Run'));

    expect((await screen.findAllByText('Model unavailable')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByText('Rerun')[0]);

    await waitFor(() => {
      expect(clientMocks.rerunAgentRun).toHaveBeenCalledWith('run-failed', 'ws-1');
    });
    expect((await screen.findAllByText('Recovered answer')).length).toBeGreaterThan(0);
  });

  it('restores a persisted run on reload', async () => {
    localStorage.setItem('agent:last-run:ws-1', 'run-restored');
    clientMocks.getAgentRun.mockResolvedValue({
      ...makeRun({
        id: 'run-restored',
        runId: 'run-restored',
        status: 'completed',
        title: 'Restored research',
        input: 'Restore my previous work',
        inputSummary: 'Restore my previous work',
        outputSummary: 'Restored answer',
        output: 'Restored answer',
        result: { answer: 'Restored answer' },
      }),
      jobId: 'job-restored',
      errorCode: null,
      citations: [],
      relatedArtifacts: [],
      steps: [],
    });

    render(<AgentPanel workspaceId="ws-1" activeDoc={null} workspaceMembershipSummary={adminMembership} />);

    await waitFor(() => {
      expect(clientMocks.getAgentRun).toHaveBeenCalledWith('run-restored', 'ws-1');
    });
    expect(await screen.findByText('Final Output')).toBeInTheDocument();
    expect(screen.getAllByText('Restore my previous work').length).toBeGreaterThan(0);
    expect(
      within(screen.getByText('Final Output').closest('div')!.parentElement!).getByText('Restored answer')
    ).toBeInTheDocument();
  });

  it('shows read-only agent state for viewers', async () => {
    clientMocks.listAgentRuns.mockResolvedValue({
      items: [{ ...makeRun({ status: 'completed' }), runId: 'run-1', inputPreview: 'Investigate roadmap', outputPreview: 'No output available yet' }],
      nextCursor: null,
    });

    render(<AgentPanel workspaceId="ws-1" activeDoc={null} workspaceMembershipSummary={viewerMembership} />);

    expect(screen.getByText('Read-only agent access')).toBeInTheDocument();
    expect(screen.getByText(/only editors and admins can start or rerun/i)).toBeInTheDocument();
    expect(screen.getByText('Run')).toBeDisabled();
  });
});
