import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

const mockPool = {
  query: vi.fn(),
};

const mockDocumentModel = {
  findById: vi.fn(),
};

const mockGetLatestStoredSnapshot = vi.fn();

vi.mock('../db/client.js', () => ({
  pool: mockPool,
}));

vi.mock('../models/document.js', () => ({
  DocumentModel: mockDocumentModel,
}));

vi.mock('../db/snapshots.js', () => ({
  getLatestStoredSnapshot: mockGetLatestStoredSnapshot,
}));

describe('snapshot recovery drill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns missing-document report when document does not exist', async () => {
    mockDocumentModel.findById.mockResolvedValue(null);
    const { SnapshotService } = await import('./snapshot.js');
    const service = new SnapshotService();

    const report = await service.runRecoveryDrill('doc-missing');

    expect(report.checks.document_exists).toBe(false);
    expect(report.checks.restore_success).toBe(false);
    expect(report.warnings).toContain('Document not found');
  });

  it('uses yjs_snapshots fallback when document_snapshots restore fails', async () => {
    mockDocumentModel.findById.mockResolvedValue({ id: 'doc-1' });
    mockPool.query.mockImplementation(async (sqlText: string) => {
      const sql = sqlText.toLowerCase();
      if (sql.includes('count(*)::int as count') && sql.includes('from document_snapshots')) {
        return { rows: [{ count: 0 }], rowCount: 1 };
      }
      if (sql.includes('select yjs_snapshot, metadata from document_snapshots')) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unhandled SQL: ${sqlText}`);
    });

    const sourceDoc = new Y.Doc();
    sourceDoc.getMap('blocks').set('b1', { text: 'hello' });
    mockGetLatestStoredSnapshot.mockResolvedValue(Y.encodeStateAsUpdate(sourceDoc));

    const { SnapshotService } = await import('./snapshot.js');
    const service = new SnapshotService();
    const report = await service.runRecoveryDrill('doc-1');

    expect(report.checks.document_exists).toBe(true);
    expect(report.checks.restore_success).toBe(true);
    expect(report.checks.restore_source).toBe('yjs_snapshots');
    expect(report.checks.restored_blocks_count).toBe(1);
  });
});
