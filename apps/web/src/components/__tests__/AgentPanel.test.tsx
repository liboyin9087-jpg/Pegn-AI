import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AgentPanel from '../AgentPanel';

const clientMocks = vi.hoisted(() => ({
  createAgentRun: vi.fn(),
  getAgentRun: vi.fn(),
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
    workspaceId: 'ws-1',
    userId: 'user-1',
    type: 'research',
    mode: 'auto',
    status: 'queued',
    inputSummary: 'Investigate roadmap',
    outputSummary: null,
    errorSummary: null,
    createdAt: '2026-03-07T10:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    depth: 0,
    result: null,
    steps: [],
    ...overrides,
  };
}

describe('AgentPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    clientMocks.listAgentRuns.mockResolvedValue({ runs: [] });
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

    render(<AgentPanel workspaceId="ws-1" activeDoc={null} />);

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
    clientMocks.getAgentRun.mockResolvedValue(makeRun({ status: 'running' }));

    render(<AgentPanel workspaceId="ws-1" activeDoc={null} />);

    fireEvent.change(screen.getByPlaceholderText('Ask the agent to investigate a topic...'), {
      target: { value: 'Investigate roadmap' },
    });
    fireEvent.click(screen.getByText('Run'));

    expect(await screen.findByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Final Output')).toBeInTheDocument();
    expect(screen.getByText('Final answer')).toBeInTheDocument();
  });

  it('renders failed state and retries as a new run', async () => {
    clientMocks.createAgentRun
      .mockResolvedValueOnce(makeRun({ id: 'run-failed' }))
      .mockResolvedValueOnce(makeRun({ id: 'run-retry' }));
    clientMocks.getAgentRun
      .mockResolvedValueOnce(makeRun({ id: 'run-failed', status: 'running' }))
      .mockResolvedValueOnce(makeRun({ id: 'run-retry', status: 'running' }));
    clientMocks.streamAgentRun
      .mockImplementationOnce((_runId, _wsId, onData, onDone) => {
        setTimeout(() => {
          onData({
            type: 'run',
            run: makeRun({
              id: 'run-failed',
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
              status: 'completed',
              outputSummary: 'Recovered answer',
              result: { answer: 'Recovered answer' },
            }),
          });
          onDone();
        }, 0);
        return () => {};
      });

    render(<AgentPanel workspaceId="ws-1" activeDoc={null} />);

    fireEvent.change(screen.getByPlaceholderText('Ask the agent to investigate a topic...'), {
      target: { value: 'Investigate roadmap' },
    });
    fireEvent.click(screen.getByText('Run'));

    expect(await screen.findByText('Model unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry as new run'));

    await waitFor(() => {
      expect(clientMocks.createAgentRun).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('Recovered answer')).toBeInTheDocument();
  });

  it('restores a persisted run on reload', async () => {
    localStorage.setItem('agent:last-run:ws-1', 'run-restored');
    clientMocks.getAgentRun.mockResolvedValue(makeRun({
      id: 'run-restored',
      status: 'completed',
      outputSummary: 'Restored answer',
      result: { answer: 'Restored answer' },
    }));

    render(<AgentPanel workspaceId="ws-1" activeDoc={null} />);

    await waitFor(() => {
      expect(clientMocks.getAgentRun).toHaveBeenCalledWith('run-restored', 'ws-1');
    });
    expect(await screen.findByText('Restored answer')).toBeInTheDocument();
  });
});
