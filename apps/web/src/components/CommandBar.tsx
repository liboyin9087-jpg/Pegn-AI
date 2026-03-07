import React, { useEffect, useCallback, useRef } from 'react';
import { Command } from 'cmdk';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, FileText, Plus, Upload, Sparkles, X,
  PanelLeft, Keyboard, ChevronRight, Loader2, Zap,
} from 'lucide-react';
import { search as backendSearch, type SearchResultItem } from '../api/client';

interface Doc { id: string; title: string; metadata?: any; updatedAt?: string; }

interface Props {
  open: boolean;
  onClose: () => void;
  documents: Doc[];
  onSelectDoc: (doc: Doc) => void;
  onNewDoc: () => void;
  onUpload: () => void;
  onOpenAI: () => void;
  onToggleSidebar?: () => void;
  onShowShortcuts?: () => void;
  workspaceId?: string;
}

export default function CommandBar({
  open, onClose, documents, onSelectDoc, onNewDoc, onUpload, onOpenAI,
  onToggleSidebar, onShowShortcuts, workspaceId,
}: Props) {
  const [query, setQuery] = React.useState('');
  const [searchResults, setSearchResults] = React.useState<SearchResultItem[]>([]);
  const [searching, setSearching] = React.useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (open) { setQuery(''); setSearchResults([]); setSearching(false); } }, [open]);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim() || !workspaceId) { setSearchResults([]); setSearching(false); return; }
    try {
      const res = await backendSearch({ q, workspaceId, limit: 6 });
      setSearchResults(res.items || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(() => runSearch(query), 280);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, runSearch]);

  function wrap(fn: () => void) {
    return () => { fn(); onClose(); };
  }

  const filteredDocs = query
    ? documents.filter(d => d.title.toLowerCase().includes(query.toLowerCase())).slice(0, 4)
    : documents.slice(0, 7);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="fixed inset-0 z-50"
            style={{ background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="fixed z-50 left-1/2"
            style={{ transform: 'translateX(-50%)', top: '17vh', width: 580, maxWidth: 'calc(100vw - 32px)' }}
          >
            <Command
              className="rounded-2xl overflow-hidden flex flex-col"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                boxShadow: 'var(--shadow-spotlight)',
                maxHeight: '68vh',
              }}
              onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
              shouldFilter={searchResults.length === 0}
            >
              {/* ── Search input ──────────────────────────────────── */}
              <div
                className="flex items-center gap-3 px-4"
                style={{ height: 54, borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}
              >
                {searching
                  ? <Loader2 size={15} className="animate-spin" style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
                  : <Search size={16} style={{ color: 'var(--color-text-quaternary)', flexShrink: 0 }} />
                }
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder="搜尋文件、內容片段或動作..."
                  autoFocus
                  style={{
                    flex: 1,
                    background: 'transparent',
                    outline: 'none',
                    border: 'none',
                    fontSize: 15,
                    color: 'var(--color-text-primary)',
                    caretColor: 'var(--color-accent)',
                  }}
                />
                {query ? (
                  <button
                    onClick={() => setQuery('')}
                    className="flex items-center justify-center w-5 h-5 rounded-full transition-colors"
                    style={{ background: 'var(--color-surface-tertiary)', color: 'var(--color-text-tertiary)' }}
                  >
                    <X size={10} />
                  </button>
                ) : (
                  <kbd
                    className="px-1.5 py-0.5 rounded-md"
                    style={{ fontSize: 11, color: 'var(--color-text-tertiary)', background: 'var(--color-surface-secondary)', border: '1px solid var(--color-border)', fontFamily: 'inherit' }}
                  >ESC</kbd>
                )}
              </div>

              {/* ── Results ───────────────────────────────────────── */}
              <Command.List
                className="overflow-y-auto flex-1 py-1.5"
                style={{ scrollbarWidth: 'thin' }}
              >
                <Command.Empty>
                  <div className="px-4 py-10 text-center" style={{ color: 'var(--color-text-tertiary)', fontSize: 13 }}>
                    找不到「{query}」相關結果
                  </div>
                </Command.Empty>

                {/* ── 動作 ── */}
                {!query && (
                <Command.Group heading={<GroupLabel label="動作" />}>
                  <CmdItem
                    value="新增文件 建立空白頁面"
                    iconBg="#ebf3fd" iconColor="#2383e2" Icon={Plus}
                    label="新增文件" sub="建立空白頁面"
                    onSelect={wrap(onNewDoc)}
                  />
                  <CmdItem
                    value="匯入文件 上傳 PDF Markdown TXT"
                    iconBg="#f0ebfe" iconColor="#7c3aed" Icon={Upload}
                    label="匯入文件" sub="PDF · Markdown · TXT"
                    onSelect={wrap(onUpload)}
                  />
                  <CmdItem
                    value="開啟 AI 助手 對話 GraphRAG 代理"
                    iconBg="#e4f5ed" iconColor="#0a7a4c" Icon={Sparkles}
                    label="開啟 AI 助手" sub="對話 · GraphRAG · 代理"
                    onSelect={wrap(onOpenAI)}
                  />
                </Command.Group>
                )}

                {/* ── 全文搜尋結果（後端 hybrid search）── */}
                {query && searchResults.length > 0 && (
                  <Command.Group heading={<GroupLabel label="搜尋結果" />}>
                    {searchResults.map((r, i) => (
                      <Command.Item
                        key={i}
                        value={`search_${i}_${r.documentId ?? i}`}
                        onSelect={() => {
                          if (r.documentId) {
                            const doc = documents.find(d => d.id === r.documentId);
                            onSelectDoc(doc ?? { id: r.documentId, title: r.title || 'Document' });
                          }
                          onClose();
                        }}
                        style={{ outline: 'none' }}
                        className="cmd-item"
                      >
                        <div className="flex items-start gap-3 px-3 py-2.5 cursor-pointer">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: '#ebf3fd' }}>
                            <FileText size={13} style={{ color: '#2383e2' }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="truncate" style={{ fontSize: 13.5, color: 'var(--color-text-primary)', lineHeight: '18px', fontWeight: 500 }}>
                              {r.title || 'Untitled document'}
                            </p>
                            <p className="line-clamp-1" style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', lineHeight: '16px', marginTop: 1 }}>
                              {r.snippet.slice(0, 100)}
                            </p>
                          </div>
                          <span style={{ fontSize: 10, color: 'var(--color-text-quaternary)', flexShrink: 0, fontFamily: 'monospace' }}>
                            {(r.score * 100).toFixed(0)}%
                          </span>
                        </div>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {/* ── 導航 ── */}
                {!query && (onToggleSidebar || onShowShortcuts) && (
                  <Command.Group heading={<GroupLabel label="導航" />}>
                    {onToggleSidebar && (
                      <CmdItem
                        value="切換側邊欄 sidebar toggle"
                        iconBg="var(--color-surface-tertiary)" iconColor="var(--color-text-tertiary)" Icon={PanelLeft}
                        label="切換側邊欄"
                        hint="⌘/"
                        onSelect={wrap(onToggleSidebar)}
                      />
                    )}
                    {onShowShortcuts && (
                      <CmdItem
                        value="鍵盤快捷鍵 keyboard shortcuts 說明"
                        iconBg="var(--color-surface-tertiary)" iconColor="var(--color-text-tertiary)" Icon={Keyboard}
                        label="顯示鍵盤快捷鍵"
                        hint="?"
                        onSelect={wrap(onShowShortcuts)}
                      />
                    )}
                  </Command.Group>
                )}

                {/* ── 文件標題快速跳轉 ── */}
                {filteredDocs.length > 0 && (
                  <Command.Group heading={<GroupLabel label={query ? '符合標題' : '最近文件'} />}>
                    {filteredDocs.map(doc => (
                      <CmdItem
                        key={doc.id}
                        value={`doc_${doc.title}_${doc.id}`}
                        iconBg="var(--color-surface-tertiary)" iconColor="var(--color-text-tertiary)" Icon={FileText}
                        label={doc.title}
                        sub={doc.updatedAt ? `已編輯 ${new Date(doc.updatedAt).toLocaleDateString('zh-TW')}` : '文件'}
                        onSelect={wrap(() => onSelectDoc(doc))}
                      />
                    ))}
                  </Command.Group>
                )}
              </Command.List>

              {/* ── Footer ────────────────────────────────────────── */}
              <div
                className="flex items-center gap-3 px-4 py-2 flex-shrink-0"
                style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-muted)' }}
              >
                {[
                  { keys: ['↑', '↓'], label: '導航' },
                  { keys: ['↵'], label: '選擇' },
                  { keys: ['ESC'], label: '關閉' },
                ].map(({ keys, label }) => (
                  <div key={label} className="flex items-center gap-1">
                    {keys.map(k => (
                      <kbd
                        key={k}
                        className="px-1.5 py-0.5 rounded"
                        style={{ fontSize: 10, color: 'var(--color-text-tertiary)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', fontFamily: 'inherit', lineHeight: '14px' }}
                      >{k}</kbd>
                    ))}
                    <span style={{ fontSize: 11, color: 'var(--color-text-quaternary)' }}>{label}</span>
                  </div>
                ))}
                {workspaceId && (
                  <div className="ml-auto flex items-center gap-1" style={{ fontSize: 10, color: 'var(--color-text-quaternary)' }}>
                    <Zap size={9} /> 混合語意搜尋
                  </div>
                )}
              </div>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

function GroupLabel({ label }: { label: string }) {
  return (
    <p style={{ fontSize: 10.5, color: 'var(--color-text-quaternary)', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', padding: '2px 16px 2px' }}>
      {label}
    </p>
  );
}

interface CmdItemProps {
  value: string;
  Icon: React.ElementType;
  label: string;
  sub?: string;
  hint?: string;
  iconBg: string;
  iconColor: string;
  onSelect: () => void;
}

function CmdItem({ value, Icon, label, sub, hint, iconBg, iconColor, onSelect }: CmdItemProps) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      style={{ outline: 'none' }}
      className="cmd-item"
    >
      <div
        className="flex items-center gap-3 px-3 py-2 cursor-pointer"
        style={{ borderRadius: 0 }}
      >
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: iconBg }}
        >
          <Icon size={13} style={{ color: iconColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="truncate" style={{ fontSize: 13.5, color: 'var(--color-text-primary)', lineHeight: '18px' }}>
            {label}
          </p>
          {sub && (
            <p className="truncate" style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', lineHeight: '15px' }}>
              {sub}
            </p>
          )}
        </div>
        {hint && (
          <kbd style={{ fontSize: 10.5, color: 'var(--color-text-quaternary)', background: 'var(--color-surface-secondary)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '0 5px', fontFamily: 'inherit', lineHeight: '18px' }}>
            {hint}
          </kbd>
        )}
        <ChevronRight size={12} style={{ color: 'var(--color-text-quaternary)', flexShrink: 0 }} />
      </div>
    </Command.Item>
  );
}
