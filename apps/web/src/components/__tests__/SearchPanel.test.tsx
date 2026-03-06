import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SearchPanel from '../SearchPanel';

const clientMocks = vi.hoisted(() => ({
  search: vi.fn(),
  getSearchIndexStatus: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  ...clientMocks,
}));

describe('SearchPanel lifecycle states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders pending state when documents exist but indexing has not completed', async () => {
    clientMocks.getSearchIndexStatus.mockResolvedValue({
      totalDocuments: 2,
      pendingDocuments: 2,
      indexedDocuments: 0,
      staleDocuments: 0,
      failedDocuments: 0,
      lastIndexedAt: null,
    });

    render(<SearchPanel workspaceId="ws-1" />);

    expect(await screen.findByText('2 份文件等待索引')).toBeInTheDocument();
    expect(screen.getByText('文件已存在，但索引尚未完成。')).toBeInTheDocument();
  });

  it('renders failed state copy when indexing failed', async () => {
    clientMocks.getSearchIndexStatus.mockResolvedValue({
      totalDocuments: 1,
      pendingDocuments: 0,
      indexedDocuments: 0,
      staleDocuments: 0,
      failedDocuments: 1,
      lastIndexedAt: null,
    });

    render(<SearchPanel workspaceId="ws-1" />);

    expect(await screen.findByText('1 份文件索引失敗')).toBeInTheDocument();
    expect(screen.getByText('文件存在，但目前無法完成搜尋索引。')).toBeInTheDocument();
  });

  it('renders stale hint when search returns no results', async () => {
    clientMocks.getSearchIndexStatus.mockResolvedValue({
      totalDocuments: 3,
      pendingDocuments: 0,
      indexedDocuments: 2,
      staleDocuments: 1,
      failedDocuments: 0,
      lastIndexedAt: '2026-03-07T10:20:00.000Z',
    });
    clientMocks.search.mockResolvedValue({
      results: [],
      total: 0,
      duration: 12,
    });

    render(<SearchPanel workspaceId="ws-1" />);

    fireEvent.change(screen.getByPlaceholderText('搜尋文件內容、標題與索引內容'), {
      target: { value: 'roadmap' },
    });
    fireEvent.click(screen.getByText('搜尋'));

    await waitFor(() => {
      expect(clientMocks.search).toHaveBeenCalledWith('roadmap', 'ws-1', 20, true);
    });
    expect(await screen.findByText('目前沒有符合的搜尋結果')).toBeInTheDocument();
    expect(screen.getByText('部分文件索引已過期，搜尋結果可能尚未反映最新內容。')).toBeInTheDocument();
  });
});
