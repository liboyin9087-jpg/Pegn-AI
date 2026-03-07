import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPool = { query: vi.fn() };

vi.mock('../../db/client.js', () => ({ pool: mockPool }));
vi.mock('../../services/graphrag.js', () => ({ graphRAGQuery: vi.fn() }));
vi.mock('../../services/search.js', () => ({
  searchService: {
    search: vi.fn(),
  },
}));
vi.mock('../../services/jobService.js', () => ({
  appendJobEvent: vi.fn(),
  createJob: vi.fn(),
  failJob: vi.fn(),
  getJobBySourceRunId: vi.fn().mockResolvedValue(null),
  isCancelRequested: vi.fn().mockResolvedValue(false),
  markCancelled: vi.fn(),
  markTimeout: vi.fn(),
  startJob: vi.fn(),
  succeedJob: vi.fn(),
}));

describe('agent service helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('buildRunPreview truncates long output into a single-line preview', async () => {
    const { buildRunPreview } = await import('../agent.js');
    const preview = buildRunPreview('line one\nline two '.repeat(20));
    expect(preview.length).toBeLessThanOrEqual(160);
    expect(preview).not.toContain('\n');
  });

  it('buildPromptTrace returns stable prompt metadata', async () => {
    const { buildPromptTrace } = await import('../agent.js');
    expect(buildPromptTrace({
      prompt_version: 'v2',
      prompt_label: 'research',
      template_id: 'research',
      template_version: 'v3',
    })).toEqual({
      promptVersion: 'v2',
      promptLabel: 'research',
      templateId: 'research',
      templateVersion: 'v3',
    });
  });

  it('buildRunCitations normalizes retrieved sources into canonical citations', async () => {
    const { buildRunCitations } = await import('../agent.js');
    const citations = buildRunCitations({
      retrieved: [
        {
          sources: [
            {
              type: 'document',
              document_id: 'doc-1',
              title: 'Roadmap',
              content: 'Roadmap details',
            },
          ],
        },
      ],
    });

    expect(citations).toEqual([
      {
        id: 'document:doc-1',
        title: 'Roadmap',
        sourceType: 'document',
        sourceId: 'doc-1',
        snippet: 'Roadmap details',
        href: '/documents/doc-1',
      },
    ]);
  });

  it('buildRunArtifactsSummary returns artifact metadata from agent_artifacts', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'artifact-1',
          run_id: 'run-1',
          workspace_id: 'ws-1',
          type: 'text_output',
          title: 'Final answer',
          mime_type: 'text/plain',
          size: 128,
          metadata: { provider: 'internal' },
          created_at: new Date('2026-03-07T10:00:00.000Z'),
        },
      ],
    });

    const { buildRunArtifactsSummary } = await import('../agent.js');
    const artifacts = await buildRunArtifactsSummary('run-1', 'ws-1');

    expect(artifacts).toEqual([
      {
        artifactId: 'artifact-1',
        type: 'text_output',
        title: 'Final answer',
        mimeType: 'text/plain',
        size: 128,
        metadata: { provider: 'internal' },
        createdAt: '2026-03-07T10:00:00.000Z',
      },
    ]);
  });
});
