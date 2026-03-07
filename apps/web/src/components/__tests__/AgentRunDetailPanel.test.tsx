import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentRunDetailPanel from '../AgentRunDetailPanel';
import type { AgentRunDetail } from '../../api/client';

const run: AgentRunDetail = {
  runId: 'run-1',
  workspaceId: 'ws-1',
  status: 'failed',
  input: 'Investigate roadmap',
  output: 'Final answer',
  errorCode: 'agent_run_failed',
  errorSummary: 'Model unavailable',
  jobId: 'job-1',
  promptVersion: 'v1',
  promptLabel: 'research',
  templateId: 'research',
  templateVersion: 'v1',
  citations: [
    {
      id: 'document:doc-1',
      title: 'Roadmap',
      sourceType: 'document',
      sourceId: 'doc-1',
      snippet: 'Roadmap source snippet',
      href: '/documents/doc-1',
    },
  ],
  relatedArtifacts: [
    {
      artifactId: 'artifact-1',
      type: 'text_output',
      title: 'Final answer',
      mimeType: 'text/plain',
      size: 12,
      metadata: {},
      createdAt: '2026-03-07T10:00:00.000Z',
    },
  ],
  createdAt: '2026-03-07T10:00:00.000Z',
  startedAt: '2026-03-07T10:00:01.000Z',
  finishedAt: '2026-03-07T10:00:02.000Z',
  rerunOfRunId: 'run-0',
  steps: [],
};

describe('AgentRunDetailPanel', () => {
  it('renders input, output, prompt trace, citations, artifacts, and rerun chain', () => {
    render(<AgentRunDetailPanel run={run} canRerun={true} onRerun={vi.fn()} onOpenJob={vi.fn()} />);

    expect(screen.getByText('Investigate roadmap')).toBeInTheDocument();
    expect(screen.getAllByText('Final answer').length).toBeGreaterThan(0);
    expect(screen.getByText('Prompt Trace')).toBeInTheDocument();
    expect(screen.getByText('Roadmap')).toBeInTheDocument();
    expect(screen.getByText('Artifacts')).toBeInTheDocument();
    expect(screen.getByText(/Rerun of run-0/)).toBeInTheDocument();
  });
});
