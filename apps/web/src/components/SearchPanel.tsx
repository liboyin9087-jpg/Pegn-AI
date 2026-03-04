import React, { useState, useRef, useCallback, useEffect } from 'react';
import { search, getSearchIndexStatus } from '../api/client';
import { CalendarDays, Sparkles, Hash, Info } from 'lucide-react';

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

const SCORE_COLOR = (score: number) => {
  if (score >= 0.8) return 'text-success';
  if (score >= 0.5) return 'text-warning';
  return 'text-text-tertiary';
};

// Highlight search terms in text
function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const words = query.trim().split(/\s+/).filter(w => w.length > 1);
  if (words.length === 0) return text;
  const regex = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-accent-light text-accent rounded px-0.5">{part}</mark>
    ) : part
  );
}

export default function SearchPanel({ workspaceId, onNavigateDoc }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set(['text', 'code', 'heading', 'list']));
  const [sortBy, setSortBy] = useState<'score' | 'doc'>('score');
  const [expandedResults, setExpandedResults] = useState<Set<number>>(new Set());
  // ── Advanced filter state ──────────────────────────────────────────────
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchMode, setSearchMode] = useState<'hybrid' | 'bm25'>('hybrid');
  const [totalResults, setTotalResults] = useState(0);
  const [searchDuration, setSearchDuration] = useState<number | null>(null);
  const [indexStatus, setIndexStatus] = useState<{ coverage: number; status: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load history from localStorage
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('search_history') || '[]');
      setHistory(saved);
    } catch {}
  }, []);

  // Fetch index status on mount
  useEffect(() => {
    if (!workspaceId) return;
    getSearchIndexStatus(workspaceId)
      .then(s => setIndexStatus({ coverage: s.coverage, status: s.status }))
      .catch(() => {});
  }, [workspaceId]);

  const saveHistory = useCallback((q: string) => {
    setHistory(prev => {
      const next = [q, ...prev.filter(h => h !== q)].slice(0, 10);
      localStorage.setItem('search_history', JSON.stringify(next));
      return next;
    });
  }, []);

  const handleSearch = useCallback(async (q?: string) => {
    const queryToSearch = (q ?? query).trim();
    if (!queryToSearch || !workspaceId) return;
    if (q) setQuery(q);
    setShowHistory(false);
    setLoading(true);
    setExpandedResults(new Set());
    try {
      const res = await search(queryToSearch, workspaceId, 20, searchMode === 'hybrid');
      // Client-side filter by type if needed
      let filtered = (res.results || []) as SearchResult[];
      if (dateFrom) filtered = filtered.filter(r => !r.created_at || new Date(r.created_at) >= new Date(dateFrom));
      if (dateTo)   filtered = filtered.filter(r => !r.created_at || new Date(r.created_at) <= new Date(dateTo + 'T23:59:59'));
      setResults(filtered);
      setTotalResults(res.total ?? filtered.length);
      setSearchDuration(res.duration ?? null);
      saveHistory(queryToSearch);
    } catch {
      setResults([]);
      setTotalResults(0);
    } finally {
      setLoading(false);
    }
  }, [query, workspaceId, dateFrom, dateTo]);

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('search_history');
  };

  const toggleExpand = (i: number) => {
    setExpandedResults(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  // Group results by document
  const groupedResults = sortBy === 'doc'
    ? results.reduce((acc, r) => {
        const key = r.document_title || r.title || '未命名';
        if (!acc[key]) acc[key] = [];
        acc[key].push(r);
        return acc;
      }, {} as Record<string, SearchResult[]>)
    : null;

  const displayResults = sortBy === 'score' ? results : null;

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Search input */}
      <div className="p-3 border-b border-border flex-shrink-0 space-y-2">
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
                onChange={e => { setQuery(e.target.value); setShowHistory(e.target.value === '' && history.length > 0); }}
                onFocus={() => setShowHistory(query === '' && history.length > 0)}
                onBlur={() => setTimeout(() => setShowHistory(false), 150)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSearch();
                  if (e.key === 'Escape') setShowHistory(false);
                }}
                placeholder="搜尋文件內容、概念、人名..."
                className="w-full bg-surface border border-border rounded-lg pl-9 pr-8 py-2 text-sm text-text-primary placeholder-text-tertiary outline-none focus:ring-2 focus:ring-accent"
              />
              {query && (
                <button
                  onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus(); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
                  aria-label="清除搜尋"
                >
                  ✕
                </button>
              )}
            </div>
            <button
              onClick={() => handleSearch()}
              disabled={loading || !query.trim()}
              className="px-3 py-2 bg-accent hover:bg-accent-hover rounded-lg text-white text-sm disabled:opacity-40 transition-colors flex-shrink-0"
            >{loading ? '...' : '搜尋'}</button>
          </div>

          {/* History dropdown */}
          {showHistory && history.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg z-20 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
                <span className="text-xs text-text-tertiary">搜尋記錄</span>
                <button onClick={clearHistory} className="text-xs text-text-tertiary hover:text-text-secondary">清除</button>
              </div>
              {history.map((h, i) => (
                <button
                  key={i}
                  onMouseDown={() => handleSearch(h)}
                  className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-tertiary transition-colors flex items-center gap-2"
                >
                  <span className="text-text-tertiary">🕐</span> {h}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Index status badge */}
        {indexStatus && (
          <div className="flex items-center gap-1.5">
            <span
              className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
              style={{
                background: indexStatus.status === 'complete' ? 'var(--color-success-light, #d1fae5)' :
                            indexStatus.status === 'partial'  ? 'var(--color-warning-light, #fef3c7)' :
                            'var(--color-surface-tertiary)',
                color: indexStatus.status === 'complete' ? 'var(--color-success, #059669)' :
                       indexStatus.status === 'partial'  ? 'var(--color-warning, #d97706)' :
                       'var(--color-text-tertiary)',
              }}
            >
              <Info size={9} />
              索引覆蓋率 {indexStatus.coverage}%
              {indexStatus.status === 'empty' && ' — 請先建立索引'}
            </span>
          </div>
        )}

        {/* Controls row */}
        {results.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-text-tertiary">
              {totalResults} 個結果
              {searchDuration != null && (
                <span className="text-text-quaternary ml-1">({searchDuration}ms)</span>
              )}
            </span>
            <div className="flex-1" />
            {/* Mode toggle */}
            <button
              onClick={() => setSearchMode(m => m === 'hybrid' ? 'bm25' : 'hybrid')}
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md transition-colors"
              style={{
                background: searchMode === 'hybrid' ? 'var(--color-accent-light)' : 'var(--color-surface-tertiary)',
                color: searchMode === 'hybrid' ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
                border: `1px solid ${searchMode === 'hybrid' ? 'var(--color-accent)' : 'var(--color-border)'}`,
              }}
              title={searchMode === 'hybrid' ? '切換為關鍵字模式' : '切換為語意模式'}
            >
              {searchMode === 'hybrid'
                ? <><Sparkles size={10} /> 語意</>
                : <><Hash size={10} /> 關鍵字</>
              }
            </button>
            {/* Advanced filter toggle */}
            <button
              onClick={() => setShowAdvanced(s => !s)}
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md transition-colors"
              style={{
                background: showAdvanced ? 'var(--color-surface-tertiary)' : 'transparent',
                color: showAdvanced ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)',
                border: '1px solid var(--color-border)',
              }}
            >
              <CalendarDays size={10} /> 篩選
            </button>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              className="text-xs bg-surface border border-border rounded px-2 py-0.5 text-text-tertiary outline-none"
            >
              <option value="score">按相關度排序</option>
              <option value="doc">按文件分組</option>
            </select>
          </div>
        )}

        {/* Advanced filter panel */}
        {showAdvanced && (
          <div className="p-2 rounded-lg space-y-1.5" style={{ background: 'var(--color-surface-secondary)', border: '1px solid var(--color-border)' }}>
            <p className="text-xs font-medium" style={{ color: 'var(--color-text-tertiary)' }}>日期範圍</p>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-text-tertiary block mb-0.5">從</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="w-full px-2 py-1 rounded text-xs outline-none"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-text-tertiary block mb-0.5">到</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="w-full px-2 py-1 rounded text-xs outline-none"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                />
              </div>
              {(dateFrom || dateTo) && (
                <button
                  onClick={() => { setDateFrom(''); setDateTo(''); }}
                  className="self-end text-xs text-text-tertiary hover:text-text-secondary pb-1"
                >
                  清除
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && results.length === 0 && query && (
          <div className="text-center py-8">
            <p className="text-sm text-text-secondary mb-1">無搜尋結果</p>
            <p className="text-xs text-text-tertiary">嘗試使用不同關鍵字，或先建立文件索引</p>
          </div>
        )}

        {!loading && results.length === 0 && !query && history.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-text-tertiary px-1">最近搜尋</p>
            {history.map((h, i) => (
              <button
                key={i}
                onClick={() => handleSearch(h)}
                className="w-full text-left text-xs px-3 py-2 rounded-lg bg-panel hover:bg-surface-tertiary border border-border text-text-secondary transition-colors"
              >
                🕐 {h}
              </button>
            ))}
          </div>
        )}

        {/* Score-sorted results */}
        {!loading && displayResults && displayResults.map((r, i) => (
          <button
            key={i}
            type="button"
            className="bg-panel hover:bg-surface-tertiary rounded-xl p-3 transition-colors border border-border cursor-pointer text-left w-full"
            onClick={() => toggleExpand(i)}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex-1 min-w-0">
                <span
                  className="text-xs font-medium text-accent truncate block hover:underline cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (r.document_id && onNavigateDoc) onNavigateDoc(r.document_id);
                  }}
                  title="點擊跳轉至文件"
                >
                  📄 {r.document_title || r.title || '未命名'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {r.block_type && (
                  <span className="text-xs text-text-tertiary bg-surface-tertiary px-1.5 py-0.5 rounded">{r.block_type}</span>
                )}
                <span className={`text-xs font-mono font-medium ${SCORE_COLOR(r.score)}`}>
                  {(r.score * 100).toFixed(0)}%
                </span>
              </div>
            </div>
            <p className={`text-xs text-text-secondary leading-relaxed ${expandedResults.has(i) ? '' : 'line-clamp-2'}`}>
              {highlight(r.content, query)}
            </p>
            {r.content.length > 120 && (
              <span className="text-xs text-text-tertiary mt-0.5 block">
                {expandedResults.has(i) ? '收起' : '展開'}
              </span>
            )}
          </button>
        ))}

        {/* Document-grouped results */}
        {!loading && groupedResults && Object.entries(groupedResults).map(([docTitle, docResults]) => (
          <div key={docTitle} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-accent">📄 {docTitle}</span>
              <span className="text-xs text-text-tertiary">({docResults.length} 個片段)</span>
              {docResults[0]?.document_id && onNavigateDoc && (
                <button
                  onClick={() => onNavigateDoc(docResults[0].document_id!)}
                  className="text-xs text-text-tertiary hover:text-accent transition-colors"
                >→ 開啟</button>
              )}
            </div>
            {docResults.map((r, i) => (
              <div key={i} className="bg-panel rounded-lg p-2.5 border-l-2 border-accent/30">
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-mono ${SCORE_COLOR(r.score)}`}>{(r.score * 100).toFixed(0)}%</span>
                  {r.block_type && <span className="text-xs text-text-tertiary">{r.block_type}</span>}
                </div>
                <p className="text-xs text-text-secondary leading-relaxed line-clamp-3">
                  {highlight(r.content, query)}
                </p>
              </div>
            ))}
          </div>
        ))}

        {!loading && results.length === 0 && !query && history.length === 0 && (
          <div className="text-center py-8">
            <div className="text-3xl mb-2">🔍</div>
            <p className="text-sm text-text-secondary mb-1">混合語意搜尋</p>
            <p className="text-xs text-text-tertiary">結合向量相似度 + BM25 關鍵字搜尋</p>
            <p className="text-xs text-text-tertiary mt-0.5">先為文件建立索引，再進行搜尋</p>
            <div className="flex items-center justify-center gap-3 mt-3">
              <span
                className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md"
                style={{ background: 'var(--color-accent-light)', color: 'var(--color-accent)', border: '1px solid var(--color-accent)' }}
              >
                <Sparkles size={9} /> 語意搜尋
              </span>
              <span className="text-xs text-text-quaternary">+</span>
              <span
                className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md"
                style={{ background: 'var(--color-surface-tertiary)', color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }}
              >
                <Hash size={9} /> BM25 關鍵字
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
