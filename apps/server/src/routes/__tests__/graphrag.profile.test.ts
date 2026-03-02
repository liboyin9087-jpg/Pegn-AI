import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signToken } from '../../middleware/auth.js';

const mockGraphRAGQuery = vi.fn();
const mockPool = { query: vi.fn() };

vi.mock('../../services/graphrag.js', () => ({
  graphRAGQuery: mockGraphRAGQuery,
}));

vi.mock('../../db/client.js', () => ({
  pool: mockPool,
}));

function makeGraphProfile() {
  return {
    timing_ms: {
      embedding: 1,
      vector_search: 2,
      bm25_search: 3,
      entity_search: 4,
      neighbor_expand: 5,
      fusion: 6,
      generation: 7,
      total: 28,
    },
    hit_counts: {
      vector: 2,
      bm25: 3,
      entities: 1,
      graph_chunks: 1,
      fused: 3,
    },
    model: {
      embedding_model: 'text-embedding-004',
      generation_model: 'gemini-2.5-flash',
      used_generation: true,
    },
  };
}

async function createApp() {
  const { registerGraphRAGRoutes } = await import('../graphrag.js');
  const app = express();
  app.use(express.json());
  registerGraphRAGRoutes(app);
  return app;
}

describe('graphrag profiling routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.query.mockImplementation(async (sqlText: string) => {
      const sql = sqlText.toLowerCase();
      if (sql.includes('from workspace_members m')) {
        return {
          rows: [{
            legacy_role: 'editor',
            role_name: 'editor',
            permissions: ['collection:view'],
          }],
          rowCount: 1,
        };
      }
      throw new Error(`Unhandled SQL: ${sqlText}`);
    });

    mockGraphRAGQuery.mockResolvedValue({
      answer: 'Graph answer',
      sources: [],
      entities: [],
      citations: [],
      debug: { profile: makeGraphProfile() },
    });
  });

  it('passes includeProfile=true to service when debug is enabled', async () => {
    const app = await createApp();
    const token = signToken('user-1', 'user1@example.com');

    const response = await request(app)
      .post('/api/v1/graphrag/query')
      .set('Authorization', `Bearer ${token}`)
      .send({
        query: 'project timeline',
        workspace_id: 'ws-1',
        debug: true,
      });

    expect(response.status).toBe(200);
    expect(mockGraphRAGQuery).toHaveBeenCalledWith(
      'project timeline',
      'ws-1',
      10,
      { includeProfile: true }
    );
    expect(response.body.debug.profile.timing_ms.total).toBe(28);
  });

  it('defaults includeProfile=false when debug flag is missing', async () => {
    const app = await createApp();
    const token = signToken('user-1', 'user1@example.com');

    const response = await request(app)
      .post('/api/v1/graphrag/query')
      .set('Authorization', `Bearer ${token}`)
      .send({
        query: 'project timeline',
        workspace_id: 'ws-1',
      });

    expect(response.status).toBe(200);
    expect(mockGraphRAGQuery).toHaveBeenCalledWith(
      'project timeline',
      'ws-1',
      10,
      { includeProfile: false }
    );
  });

  it('includes profile in stream meta events', async () => {
    const app = await createApp();
    const token = signToken('user-1', 'user1@example.com');

    const response = await request(app)
      .post('/api/v1/graphrag/stream')
      .set('Authorization', `Bearer ${token}`)
      .send({
        query: 'project timeline',
        workspace_id: 'ws-1',
        debug: true,
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toContain('"schema_version":"v1"');
    expect(response.text).toContain('"type":"meta"');
    expect(response.text).toContain('"profile"');
  });
});
