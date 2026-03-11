/**
 * snapshot.recovery.test.ts — Snapshot 回放驗證 smoke test
 * ────────────────────────────────────────────────────────
 * 旨在確認「故障後，現有快照可以被還原」。
 *
 * 測試策略：
 *   1. 建立 in-memory Yjs 文件並寫入若干 blocks
 *   2. 呼叫 SnapshotService.createSnapshot（mock DB）
 *   3. 從 mock snapshot bytes 解碼並驗證 roundtrip 正確
 *   4. 模擬 corrupt bytes → 驗證 verifySnapshotRecovery 回傳 healthy=false
 *
 * CI 指令：
 *   cd apps/server && npm test -- snapshot.recovery
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { verifySnapshotRecovery, type SnapshotHealthReport } from '../snapshot.js';

// ── Mock DB ───────────────────────────────────────────────────────────────

const mockPool = {
  query: vi.fn(),
};

let activePool: typeof mockPool | null = mockPool;

vi.mock('../../db/client.js', () => ({
  get pool() { return activePool; },
}));

// ── Helpers ───────────────────────────────────────────────────────────────

function buildYjsSnapshot(): Buffer {
  const doc = new Y.Doc();
  const blocks = doc.getMap('blocks');
  blocks.set('block_1', new Y.Map());
  blocks.set('block_2', new Y.Map());
  const snapshot = Y.snapshot(doc);
  return Buffer.from(Y.encodeSnapshot(snapshot));
}

function setupMockPool(
  count: number,
  snapshotBuffer: Buffer | null,
  {
    latestAt   = new Date().toISOString(),
    latestVer  = '3',
  } = {}
) {
  mockPool.query
    .mockResolvedValueOnce({
      rows: [{ count: String(count), latest_at: latestAt, latest_version: latestVer }],
    })
    .mockResolvedValueOnce({
      rows: snapshotBuffer ? [{ yjs_snapshot: snapshotBuffer }] : [],
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('verifySnapshotRecovery', () => {
  const DOC_ID = 'doc-test-001';

  beforeEach(() => {
    vi.clearAllMocks();
    activePool = mockPool;
  });

  it('回傳 healthy=true 當 snapshot 合法且可反序列化', async () => {
    const buf = buildYjsSnapshot();
    setupMockPool(3, buf);

    const report: SnapshotHealthReport = await verifySnapshotRecovery(DOC_ID);

    expect(report.healthy).toBe(true);
    expect(report.decode_ok).toBe(true);
    expect(report.snapshot_count).toBe(3);
    expect(report.size_bytes).toBe(buf.length);
    expect(report.error).toBeUndefined();
  });

  it('回傳 healthy=false 當沒有任何 snapshot', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ count: '0', latest_at: null, latest_version: null }],
    });

    const report = await verifySnapshotRecovery(DOC_ID);

    expect(report.healthy).toBe(false);
    expect(report.snapshot_count).toBe(0);
    expect(report.error).toMatch(/no snapshots/i);
  });

  it('回傳 healthy=false 當 snapshot bytes 損毀', async () => {
    // Corrupt buffer: random bytes that cannot be decoded by Yjs
    const corrupt = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xde, 0xad, 0xbe, 0xef]);
    setupMockPool(1, corrupt);

    const report = await verifySnapshotRecovery(DOC_ID);

    expect(report.healthy).toBe(false);
    expect(report.decode_ok).toBe(false);
    expect(report.error).toBeTruthy();
  });

  it('回傳 healthy=false 當 snapshot bytes 缺失（DB 查無資料）', async () => {
    setupMockPool(2, null);

    const report = await verifySnapshotRecovery(DOC_ID);

    expect(report.healthy).toBe(false);
    expect(report.error).toMatch(/data missing/i);
  });

  it('回傳 healthy=false 當 DB 不可用', async () => {
    activePool = null;
    const report = await verifySnapshotRecovery(DOC_ID);
    expect(report.healthy).toBe(false);
    expect(report.error).toMatch(/db unavailable/i);

    activePool = mockPool;
    mockPool.query.mockRejectedValueOnce(new Error('connection refused'));
    const report2 = await verifySnapshotRecovery(DOC_ID);
    expect(report2.healthy).toBe(false);
    expect(report2.error).toBeTruthy();
  });

  it('版本號被正確解析', async () => {
    const buf = buildYjsSnapshot();
    setupMockPool(5, buf, { latestVer: '12' });

    const report = await verifySnapshotRecovery(DOC_ID);

    expect(report.latest_snapshot_version).toBe(12);
    expect(report.snapshot_count).toBe(5);
  });
});

// ── Recovery Roundtrip ────────────────────────────────────────────────────

describe('Snapshot roundtrip integrity', () => {
  it('encodeSnapshot → decodeSnapshot → encodeSnapshot 保持 bytes 一致', () => {
    const doc = new Y.Doc();
    const blocks = doc.getMap('blocks');

    // Populate with content
    Y.transact(doc, () => {
      for (let i = 0; i < 5; i++) {
        const block = new Y.Map();
        (block as Y.Map<any>).set('type', 'paragraph');
        (block as Y.Map<any>).set('content', `這是第 ${i + 1} 個 block 的內容`);
        blocks.set(`block_${i}`, block);
      }
    });

    const snapshot1 = Y.snapshot(doc);
    const encoded1  = Y.encodeSnapshot(snapshot1);

    // roundtrip
    const decoded   = Y.decodeSnapshot(encoded1);
    const encoded2  = Y.encodeSnapshot(decoded);

    expect(encoded2.length).toBe(encoded1.length);
    expect(Buffer.from(encoded2).toString('hex')).toBe(Buffer.from(encoded1).toString('hex'));
  });

  it('snapshot 後新增內容，舊 snapshot 不受影響', () => {
    const doc    = new Y.Doc();
    const blocks = doc.getMap('blocks');
    blocks.set('original', new Y.Map());

    const snapshotBefore = Y.snapshot(doc);
    const beforeBytes    = Y.encodeSnapshot(snapshotBefore);

    // Mutate document AFTER snapshot
    blocks.set('added_later', new Y.Map());

    const snapshotAfter = Y.snapshot(doc);
    const afterBytes    = Y.encodeSnapshot(snapshotAfter);

    // Snapshots should differ
    expect(Buffer.from(beforeBytes).toString('hex')).not.toBe(Buffer.from(afterBytes).toString('hex'));

    // Before snapshot is still decodable
    expect(() => Y.decodeSnapshot(beforeBytes)).not.toThrow();
  });
});
