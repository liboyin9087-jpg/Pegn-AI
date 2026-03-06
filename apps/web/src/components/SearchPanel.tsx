import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, Hash, Info, Sparkles } from 'lucide-react';
import { getSearchIndexStatus, search, type SearchIndexStatusResponse } from '../api/client';

interface SearchResult {
  document_id?: string;
  document_title?: string;
  title?: string;
  content: string;
  score: number;
  block_type?: string;
  created_at?: string;
}

interface Props {
  workspaceId: string;
  onNavigateDoc?: (docId: string) => void;
}

function getScoreColor(score: number) {
  if (score >= 0.8) return 'text-success';
  if (score >= 0.5) return 'text-warning';
  return 'text-text-tertiary';
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const words = query.trim().split(/\s+/).filter((word) => word.length > 1);
  if (words.length === 0) return text;

  const regex = new RegExp(`(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <mark key={`${part}-${index}`} className="rounded bg-accent-light px-0.5 text-accent">
        {part}
      </mark>
    ) : (
      <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
    )
  );
}

function getLifecycleMeta(summary: SearchIndexStatusResponse | null): {
  tone: 'neutral' | 'success' | 'warning' | 'danger';
  label: string;
  description: string;
} | null {
  if (!summary) return null;
  if (summary.totalDocuments === 0) {
    return {
      tone: 'neutral',
      label: '尚無可搜尋文件',
      description: '建立文件後，這裡會開始顯示索引狀態。',
    };
  }
  if (summary.failedDocuments > 0 && summary.indexedDocuments === 0) {
    return {
      tone: 'danger',
      label: `${summary.failedDocuments} 份文件索引失敗`,
      description: '文件存在，但目前無法完成搜尋索引。',
    };
  }
  if (summary.pendingDocuments > 0 && summary.indexedDocuments === 0) {
    return {
      tone: 'warning',
      label: `${summary.pendingDocuments} 份文件等待索引`,
      description: '文件已存在，但索引尚未完成。',
    };
  }
  if (summary.staleDocuments > 0) {
    return {
      tone: 'warning',
      label: `${summary.staleDocuments} 份文件索引已過期`,
      description: '搜尋結果可能不是最新版本。',
    };
  }
  return {
    tone: 'success',
    label: `${summary.indexedDocuments} 份文件已可搜尋`,
    description: '目前搜尋索引與文件內容一致。',
  };
}

function getLifecycleColors(tone: 'neutral' | 'success' | 'warning' | 'danger') {
  switch (tone) {
    case 'success':
      return {
        background: 'var(--color-success-light, #d1fae5)',
        color: 'var(--color-success, #059669)',
      };
    case 'warning':
      return {
        background: 'var(--color-warning-light, #fef3c7)',
        color: 'var(--color-warning, #d97706)',
      };
    case 'danger':
      return {
        background: 'rgba(254, 226, 226, 1)',
        color: 'rgb(185, 28, 28)',
      };
    default:
      return {
        background: 'var(--color-surface-tertiary)',
        color: 'var(--color-text-tertiary)',
      };
  }
}

function getEmptyStateCopy(summary: SearchIndexStatusResponse | null, hasQuery: boolean) {
  if (!summary || summary.totalDocuments === 0) {
    return {
      title: hasQuery ? '目前沒有可搜尋文件' : '建立第一份可搜尋文件',
      body: hasQuery
        ? '建立文件後，完成索引就會出現在搜尋結果。'
        : '文件建立後，這裡會顯示搜尋結果與索引狀態。',
    };
  }

  if (summary.failedDocuments > 0 && summary.indexedDocuments === 0) {
    return {
      title: '文件目前無法完成搜尋索引',
      body: '請稍後重試；系統暫時不會顯示失敗文件的結果。',
    };
  }

  if (summary.pendingDocuments > 0 && summary.indexedDocuments === 0) {
    return {
      title: '文件已存在，但索引尚未完成',
      body: '稍後即可搜尋到最新內容。',
    };
  }

  if (summary.staleDocuments > 0 && hasQuery) {
    return {
      title: '目前沒有符合的搜尋結果',
      body: '部分文件索引已過期，搜尋結果可能尚未反映最新內容。',
    };
  }

  return {
    title: hasQuery ? '沒有找到相符內容' : '開始搜尋文件內容',
    body: hasQuery ? '可以調整關鍵字，或稍後再試一次。' : '輸入關鍵字以搜尋文件與索引內容。',
  };
}

export default function SearchPanel({ workspaceId, onNavigateDoc }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [sortBy, setSortBy] = useState<'score' | 'doc'>('score');
  const [expandedResults, setExpandedResults] = useState<Set<number>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchMode, setSearchMode] = useState<'hybrid' | 'bm25'>('hybrid');
  const [totalResults, setTotalResults] = useState(0);
  const [searchDuration, setSearchDuration] = useState<number | null>(null);
  const [indexStatus, setIndexStatus] = useState<SearchIndexStatusResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('search_history') || '[]');
      setHistory(Array.isArray(saved) ? saved : []);
    } catch {
      setHistory([]);
    }
  }, []);

  const refreshIndexStatus = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const next = await getSearchIndexStatus(workspaceId);
      setIndexStatus(next);
    } catch {
      setIndexStatus(null);
    }
  }, [workspaceId]);

  useEffect(() => {
    refreshIndexStatus();
  }, [refreshIndexStatus]);

  const saveHistory = useCallback((nextQuery: string) => {
    setHistory((prev) => {
      const next = [nextQuery, ...prev.filter((item) => item !== nextQuery)].slice(0, 10);
      localStorage.setItem('search_history', JSON.stringify(next));
      return next;
    });
  }, []);

  const handleSearch = useCallback(async (nextQuery?: string) => {
    const queryToSearch = (nextQuery ?? query).trim();
    if (!queryToSearch || !workspaceId) return;

    if (nextQuery) setQuery(nextQuery);
    setShowHistory(false);
    setLoading(true);
    setExpandedResults(new Set());

    try {
      const response = await search(queryToSearch, workspaceId, 20, searchMode === 'hybrid');
      let filtered = (response.results || []) as SearchResult[];
      if (dateFrom) {
        filtered = filtered.filter((result) => !result.created_at || new Date(result.created_at) >= new Date(dateFrom));
      }
      if (dateTo) {
        filtered = filtered.filter((result) => !result.created_at || new Date(result.created_at) <= new Date(`${dateTo}T23:59:59`));
      }

      setResults(filtered);
      setTotalResults(response.total ?? filtered.length);
      setSearchDuration(response.duration ?? null);
      saveHistory(queryToSearch);
    } catch {
      setResults([]);
      setTotalResults(0);
      setSearchDuration(null);
    } finally {
      setLoading(false);
      refreshIndexStatus();
    }
  }, [dateFrom, dateTo, query, refreshIndexStatus, saveHistory, searchMode, workspaceId]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    localStorage.removeItem('search_history');
  }, []);

  const toggleExpand = useCallback((index: number) => {
    setExpandedResults((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const groupedResults =
    sortBy === 'doc'
      ? results.reduce<Record<string, SearchResult[]>>((acc, result) => {
          const key = result.document_title || result.title || '未命名文件';
          if (!acc[key]) acc[key] = [];
          acc[key].push(result);
          return acc;
        }, {})
      : null;

  const lifecycleMeta = getLifecycleMeta(indexStatus);
  const lifecycleColors = lifecycleMeta ? getLifecycleColors(lifecycleMeta.tone) : null;
  const emptyState = getEmptyStateCopy(indexStatus, query.trim().length > 0);

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex-shrink-0 space-y-2 border-b border-border p-3">
        <div className="relative">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="6" cy="6" r="4" />
                  <path d="M9 9l3 3" />
                </svg>
              </div>
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setShowHistory(event.target.value === '' && history.length > 0);
                }}
                onFocus={() => setShowHistory(query === '' && history.length > 0)}
                onBlur={() => setTimeout(() => setShowHistory(false), 150)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleSearch();
                  if (event.key === 'Escape') setShowHistory(false);
                }}
                placeholder="搜尋文件內容、標題與索引內容"
                className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-8 text-sm text-text-primary outline-none placeholder:text-text-tertiary focus:ring-2 focus:ring-accent"
              />
              {query && (
                <button
                  onClick={() => {
                    setQuery('');
                    setResults([]);
                    inputRef.current?.focus();
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
                  aria-label="清除搜尋"
                >
                  ×
                </button>
              )}
            </div>
            <button
              onClick={() => handleSearch()}
              disabled={loading || !query.trim()}
              className="flex-shrink-0 rounded-lg bg-accent px-3 py-2 text-sm text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              {loading ? '...' : '搜尋'}
            </button>
          </div>

          {showHistory && history.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
              <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
                <span className="text-xs text-text-tertiary">最近搜尋</span>
                <button onClick={clearHistory} className="text-xs text-text-tertiary hover:text-text-secondary">
                  清除
                </button>
              </div>
              {history.map((item, index) => (
                <button
                  key={`${item}-${index}`}
                  onMouseDown={() => handleSearch(item)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-surface-tertiary"
                >
                  <span className="text-text-tertiary">↺</span>
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>

        {lifecycleMeta && lifecycleColors && (
          <div className="space-y-1">
            <div
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
              style={{ background: lifecycleColors.background, color: lifecycleColors.color }}
            >
              <Info size={10} />
              {lifecycleMeta.label}
            </div>
            <p className="text-xs text-text-tertiary">{lifecycleMeta.description}</p>
            <div className="flex flex-wrap gap-2 text-xs text-text-tertiary">
              <span>總文件 {indexStatus?.totalDocuments ?? 0}</span>
              <span>pending {indexStatus?.pendingDocuments ?? 0}</span>
              <span>indexed {indexStatus?.indexedDocuments ?? 0}</span>
              <span>stale {indexStatus?.staleDocuments ?? 0}</span>
              <span>failed {indexStatus?.failedDocuments ?? 0}</span>
              {indexStatus?.lastIndexedAt && <span>最後索引 {new Date(indexStatus.lastIndexedAt).toLocaleString()}</span>}
            </div>
          </div>
        )}

        {results.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-tertiary">
              {totalResults} 筆結果
              {searchDuration != null && <span className="ml-1 text-text-quaternary">({searchDuration}ms)</span>}
            </span>
            <div className="flex-1" />
            <button
              onClick={() => setSearchMode((current) => (current === 'hybrid' ? 'bm25' : 'hybrid'))}
              className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors"
              style={{
                background: searchMode === 'hybrid' ? 'var(--color-accent-light)' : 'var(--color-surface-tertiary)',
                color: searchMode === 'hybrid' ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
                border: `1px solid ${searchMode === 'hybrid' ? 'var(--color-accent)' : 'var(--color-border)'}`,
              }}
              title={searchMode === 'hybrid' ? '目前使用 Hybrid Search' : '目前使用 BM25'}
            >
              {searchMode === 'hybrid' ? (
                <>
                  <Sparkles size={10} />
                  Hybrid
                </>
              ) : (
                <>
                  <Hash size={10} />
                  BM25
                </>
              )}
            </button>
            <button
              onClick={() => setShowAdvanced((current) => !current)}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-text-tertiary transition-colors"
              style={{
                background: showAdvanced ? 'var(--color-surface-tertiary)' : 'transparent',
              }}
            >
              <CalendarDays size={10} />
              日期篩選
            </button>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as 'score' | 'doc')}
              className="rounded border border-border bg-surface px-2 py-0.5 text-xs text-text-tertiary outline-none"
            >
              <option value="score">依分數排序</option>
              <option value="doc">依文件分組</option>
            </select>
          </div>
        )}

        {showAdvanced && (
          <div
            className="space-y-1.5 rounded-lg p-2"
            style={{ background: 'var(--color-surface-secondary)', border: '1px solid var(--color-border)' }}
          >
            <p className="text-xs font-medium text-text-tertiary">日期篩選</p>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="mb-0.5 block text-xs text-text-tertiary">開始</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="w-full rounded px-2 py-1 text-xs outline-none"
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-primary)',
                  }}
                />
              </div>
              <div className="flex-1">
                <label className="mb-0.5 block text-xs text-text-tertiary">結束</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="w-full rounded px-2 py-1 text-xs outline-none"
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-primary)',
                  }}
                />
              </div>
              {(dateFrom || dateTo) && (
                <button
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                  }}
                  className="self-end pb-1 text-xs text-text-tertiary hover:text-text-secondary"
                >
                  清除
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        )}

        {!loading && results.length === 0 && query && (
          <div className="py-8 text-center">
            <p className="mb-1 text-sm text-text-secondary">{emptyState.title}</p>
            <p className="text-xs text-text-tertiary">{emptyState.body}</p>
          </div>
        )}

        {!loading && results.length === 0 && !query && history.length > 0 && (
          <div className="space-y-1.5">
            <p className="px-1 text-xs text-text-tertiary">最近搜尋</p>
            {history.map((item, index) => (
              <button
                key={`${item}-${index}`}
                onClick={() => handleSearch(item)}
                className="w-full rounded-lg border border-border bg-panel px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-surface-tertiary"
              >
                ↺ {item}
              </button>
            ))}
          </div>
        )}

        {!loading && sortBy === 'score' && results.map((result, index) => (
          <button
            key={`${result.document_id ?? 'doc'}-${index}`}
            type="button"
            className="w-full cursor-pointer rounded-xl border border-border bg-panel p-3 text-left transition-colors hover:bg-surface-tertiary"
            onClick={() => toggleExpand(index)}
          >
            <div className="mb-1 flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <span
                  className="block truncate text-xs font-medium text-accent hover:underline"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (result.document_id && onNavigateDoc) onNavigateDoc(result.document_id);
                  }}
                  title="開啟文件"
                >
                  {result.document_title || result.title || '未命名文件'}
                </span>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1.5">
                {result.block_type && (
                  <span className="rounded bg-surface-tertiary px-1.5 py-0.5 text-xs text-text-tertiary">
                    {result.block_type}
                  </span>
                )}
                <span className={`font-mono text-xs font-medium ${getScoreColor(result.score)}`}>
                  {(result.score * 100).toFixed(0)}%
                </span>
              </div>
            </div>
            <p className={`text-xs leading-relaxed text-text-secondary ${expandedResults.has(index) ? '' : 'line-clamp-2'}`}>
              {highlight(result.content, query)}
            </p>
            {result.content.length > 120 && (
              <span className="mt-0.5 block text-xs text-text-tertiary">
                {expandedResults.has(index) ? '收起' : '展開'}
              </span>
            )}
          </button>
        ))}

        {!loading && sortBy === 'doc' && groupedResults && Object.entries(groupedResults).map(([documentTitle, documentResults]) => (
          <div key={documentTitle} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-accent">{documentTitle}</span>
              <span className="text-xs text-text-tertiary">({documentResults.length} 筆)</span>
              {documentResults[0]?.document_id && onNavigateDoc && (
                <button
                  onClick={() => onNavigateDoc(documentResults[0].document_id!)}
                  className="text-xs text-text-tertiary transition-colors hover:text-accent"
                >
                  開啟文件
                </button>
              )}
            </div>
            {documentResults.map((result, index) => (
              <div key={`${documentTitle}-${index}`} className="rounded-lg border-l-2 border-accent/30 bg-panel p-2.5">
                <div className="mb-1 flex items-center justify-between">
                  <span className={`font-mono text-xs ${getScoreColor(result.score)}`}>{(result.score * 100).toFixed(0)}%</span>
                  {result.block_type && <span className="text-xs text-text-tertiary">{result.block_type}</span>}
                </div>
                <p className="line-clamp-3 text-xs leading-relaxed text-text-secondary">{highlight(result.content, query)}</p>
              </div>
            ))}
          </div>
        ))}

        {!loading && results.length === 0 && !query && history.length === 0 && (
          <div className="py-8 text-center">
            <div className="mb-2 text-3xl">⌕</div>
            <p className="mb-1 text-sm text-text-secondary">{emptyState.title}</p>
            <p className="text-xs text-text-tertiary">{emptyState.body}</p>
          </div>
        )}
      </div>
    </div>
  );
}
