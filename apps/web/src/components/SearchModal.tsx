import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, FileText, Database, Sparkles, Clock, X, ChevronRight } from 'lucide-react';

interface SearchResult {
  id: string;
  type: 'document' | 'collection' | 'kg_entity';
  title: string;
  snippet?: string;
  icon?: string;
  path?: string;
  updated_at?: string;
  score?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  workspaceId?: string;
  token?: string;
  onNavigateDoc?: (id: string) => void;
  onNavigateCollection?: (id: string) => void;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} style={{ background: '#fef3c7', color: 'inherit', borderRadius: 2 }}>{part}</mark>
      : part,
  );
}

function relativeTime(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '剛才';
  if (mins < 60) return `${mins} 分鐘前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小時前`;
  return `${Math.floor(hrs / 24)} 天前`;
}

type Filter = 'all' | 'document' | 'collection' | 'kg_entity';

export function SearchModal({ open, onClose, workspaceId, token, onNavigateDoc, onNavigateCollection }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('pegn-recent-searches') || '[]'); } catch { return []; }
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const search = useCallback(async (q: string) => {
    if (!q.trim() || !token || !workspaceId) { setResults([]); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ q, limit: '20' });
      const resp = await fetch(`${API_URL}/api/v1/search?${params}`, {
        headers: { Authorization: `Bearer ${token}`, 'x-workspace-id': workspaceId },
      });
      if (!resp.ok) throw new Error('Search failed');
      const data = await resp.json();
      // Normalize results from the existing search API
      const normalized: SearchResult[] = (data.results ?? []).map((r: any) => ({
        id: r.document_id ?? r.id,
        type: 'document' as const,
        title: r.document_title ?? r.title ?? 'Untitled',
        snippet: r.snippet ?? r.content?.slice(0, 120),
        updated_at: r.updated_at,
        score: r.score,
      }));
      setResults(normalized);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [token, workspaceId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim()) {
      debounceRef.current = window.setTimeout(() => search(query), 150);
    } else {
      setResults([]);
    }
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  const filteredResults = filter === 'all' ? results : results.filter(r => r.type === filter);

  function saveRecentSearch(q: string) {
    const next = [q, ...recentSearches.filter(s => s !== q)].slice(0, 5);
    setRecentSearches(next);
    localStorage.setItem('pegn-recent-searches', JSON.stringify(next));
  }

  function handleSelect(r: SearchResult) {
    saveRecentSearch(query);
    if (r.type === 'document' && onNavigateDoc) onNavigateDoc(r.id);
    if (r.type === 'collection' && onNavigateCollection) onNavigateCollection(r.id);
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filteredResults.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && filteredResults[selectedIdx]) handleSelect(filteredResults[selectedIdx]);
    if (e.key === 'Escape') onClose();
  }

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'document', label: '文件' },
    { key: 'collection', label: '資料庫' },
    { key: 'kg_entity', label: 'KG 實體' },
  ];

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            style={{
              position: 'fixed', inset: 0, zIndex: 1000,
              background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)',
            }}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            style={{
              position: 'fixed', top: '12vh', left: '50%', transform: 'translateX(-50%)',
              width: 'min(640px, calc(100vw - 32px))',
              maxHeight: '70vh',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 12,
              boxShadow: 'var(--shadow-2xl)',
              zIndex: 1001,
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
            }}>

            {/* Search input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              <Search size={16} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
              <input
                ref={inputRef}
                value={query}
                onChange={e => { setQuery(e.target.value); setSelectedIdx(0); }}
                onKeyDown={handleKeyDown}
                placeholder="搜尋所有內容..."
                style={{
                  flex: 1, border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 15, color: 'var(--color-text-primary)',
                }}
              />
              {query && (
                <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', display: 'flex' }}>
                  <X size={14} />
                </button>
              )}
              <kbd style={{ fontSize: 11, color: 'var(--color-text-tertiary)', background: 'var(--color-surface-tertiary)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '2px 5px' }}>
                Esc
              </kbd>
            </div>

            {/* Filter chips */}
            <div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              {FILTERS.map(f => (
                <button key={f.key} onClick={() => setFilter(f.key)}
                  style={{
                    padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                    border: `1px solid ${filter === f.key ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    background: filter === f.key ? 'var(--color-accent-light)' : 'transparent',
                    color: filter === f.key ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
                    cursor: 'pointer', transition: 'all 0.1s',
                  }}>
                  {f.label}
                </button>
              ))}
            </div>

            {/* Results */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
              {loading && (
                <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 13 }}>
                  搜尋中...
                </div>
              )}

              {!loading && !query && recentSearches.length > 0 && (
                <>
                  <div style={{ padding: '4px 14px 2px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    最近搜尋
                  </div>
                  {recentSearches.map((s, i) => (
                    <button key={i} onClick={() => setQuery(s)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                        padding: '7px 14px', background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--color-text-secondary)', fontSize: 13, textAlign: 'left',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-panel-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                      <Clock size={13} style={{ flexShrink: 0 }} />
                      {s}
                    </button>
                  ))}
                </>
              )}

              {!loading && query && filteredResults.length === 0 && (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 13 }}>
                  找不到「{query}」相關內容
                </div>
              )}

              {!loading && filteredResults.length > 0 && (
                <>
                  <div style={{ padding: '4px 14px 2px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    結果（{filteredResults.length} 筆）
                  </div>
                  {filteredResults.map((r, i) => (
                    <button
                      key={r.id + i}
                      onClick={() => handleSelect(r)}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        width: '100%', padding: '8px 14px',
                        background: i === selectedIdx ? 'var(--color-panel-hover)' : 'none',
                        border: 'none', cursor: 'pointer', textAlign: 'left',
                      }}
                      onMouseEnter={() => setSelectedIdx(i)}>
                      <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
                        {r.icon ?? (r.type === 'document' ? '📄' : r.type === 'collection' ? '🗄️' : '💡')}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {highlight(r.title, query)}
                        </p>
                        {r.snippet && (
                          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-text-tertiary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {highlight(r.snippet, query)}
                          </p>
                        )}
                        <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-text-quaternary)' }}>
                          {r.path && <span>{r.path} · </span>}
                          {relativeTime(r.updated_at)}
                        </p>
                      </div>
                      <ChevronRight size={13} style={{ color: 'var(--color-text-quaternary)', flexShrink: 0, marginTop: 3 }} />
                    </button>
                  ))}
                </>
              )}
            </div>

            {/* Footer hint */}
            <div style={{ padding: '8px 14px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: 12, flexShrink: 0 }}>
              {[['↑↓', '導航'], ['↵', '開啟'], ['Esc', '關閉']].map(([key, label]) => (
                <span key={key} style={{ fontSize: 11, color: 'var(--color-text-quaternary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <kbd style={{ background: 'var(--color-surface-tertiary)', border: '1px solid var(--color-border)', borderRadius: 3, padding: '1px 4px', fontSize: 10 }}>{key}</kbd>
                  {label}
                </span>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-text-quaternary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Sparkles size={10} /> AI 語義搜尋
              </span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
