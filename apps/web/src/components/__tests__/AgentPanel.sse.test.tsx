import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AgentPanel from '../AgentPanel';

const apiMocks = vi.hoisted(() => ({
  startResearchAgent: vi.fn(),
  startSummarizeAgent: vi.fn(),
  startSupervisorAgent: vi.fn(),
  startBrainstormAgent: vi.fn(),
  startOutlineAgent: vi.fn(),
  getToken: vi.fn(),
  api: vi.fn(),
  getAgentRunArtifacts: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  ...apiMocks,
}));

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, Array<(event: Event) => void>>();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(listener);
    this.listeners.set(type, arr);
  }

  emitMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  emitDone() {
    const arr = this.listeners.get('done') ?? [];
    arr.forEach((listener) => listener(new Event('done')));
  }
}

describe('AgentPanel SSE integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.instances = [];
    (globalThis as any).EventSource = MockEventSource;

    apiMocks.getToken.mockReturnValue('token-1');
    apiMocks.startResearchAgent.mockResolvedValue({ run_id: 'run-1' });
    apiMocks.getAgentRunArtifacts.mockResolvedValue({
      run_id: 'run-1',
      limit: 200,
      offset: 0,
      timeline: [
        {
          id: 'a1',
          run_id: 'run-1',
          step_id: 's1',
          step_key: 'planner',
          artifact_type: 'status',
          payload: { token_usage: 12 },
          created_at: new Date().toISOString(),
        },
      ],
      by_step: {},
    });
  });

  it('consumes stream envelope and finalizes on payload done', async () => {
    render(<AgentPanel workspaceId="ws-1" activeDoc={null} />);

    fireEvent.change(screen.getByPlaceholderText('輸入研究問題或主題...'), {
      target: { value: '研究題目' },
    });
    fireEvent.click(screen.getByText('▶ 執行'));

    await waitFor(() => {
      expect(apiMocks.startResearchAgent).toHaveBeenCalledWith('研究題目', 'ws-1');
      expect(MockEventSource.instances).toHaveLength(1);
    });

    const es = MockEventSource.instances[0];
    expect(es.url).toContain('/api/v1/agents/runs/run-1/stream');
    expect(es.url).toContain('token=token-1');

    await act(async () => {
      es.emitMessage({ type: 'meta', schema_version: 'v1', request_id: 'req-abcdef123456' });
      es.emitMessage({ type: 'step', step: { name: 'Planner', status: 'running' } });
      es.emitMessage({ type: 'token', token: '串流內容' });
      es.emitMessage({
        type: 'run',
        run: {
          id: 'run-1',
          status: 'done',
          type: 'research',
          steps: [{ name: 'Planner', status: 'done' }],
          result: { answer: '最終答案' },
        },
      });
      es.emitMessage({ type: 'done' });
    });

    await waitFor(() => {
      expect(screen.getByText('SSE schema v1')).toBeInTheDocument();
      expect(screen.getByText(/req req-abcdef1/)).toBeInTheDocument();
      expect(screen.getByText('最終答案')).toBeInTheDocument();
      expect(apiMocks.getAgentRunArtifacts).toHaveBeenCalledWith('run-1');
      expect(screen.getByText('▶ 執行')).toBeInTheDocument();
    });
  });

  it('finalizes when SSE done event fires', async () => {
    render(<AgentPanel workspaceId="ws-1" activeDoc={null} />);

    fireEvent.change(screen.getByPlaceholderText('輸入研究問題或主題...'), {
      target: { value: '另一個題目' },
    });
    fireEvent.click(screen.getByText('▶ 執行'));

    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1);
    });

    const es = MockEventSource.instances[0];
    await act(async () => {
      es.emitMessage({ type: 'token', token: 'A' });
      es.emitDone();
    });

    await waitFor(() => {
      expect(apiMocks.getAgentRunArtifacts).toHaveBeenCalledWith('run-1');
      expect(screen.getByText('▶ 執行')).toBeInTheDocument();
    });
  });
});
