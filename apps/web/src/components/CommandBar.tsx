import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, FileText, Plus, Upload, ArrowRight, Sparkles, X,
} from 'lucide-react';

interface Doc { id: string; title: string; metadata?: any; updatedAt?: string; }

interface Props {
  open: boolean;
  onClose: () => void;
  documents: Doc[];
  onSelectDoc: (doc: Doc) => void;
  onNewDoc: () => void;
  onUpload: () => void;
  onOpenAI: () => void;
}

type ItemKind = 'doc' | 'action';
interface Item {
  id: string;
  kind: ItemKind;
  Icon: React.ElementType;
  label: string;
  sub?: string;
  iconBg?: string;
  iconColor?: string;
  onSelect: () => void;
}

export default function CommandBar({ open, onClose, documents, onSelectDoc, onNewDoc, onUpload, onOpenAI }: Props) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  useEffect(() => { if (open) { setQuery(''); setCursor(0); } }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const staticActions: Item[] = [
    {
      id: 'new', kind: 'action', Icon: Plus,
      label: '新增文件', sub: '建立空白頁面',
      iconBg: '#ebf3fd', iconColor: '#2383e2',
      onSelect: () => { onNewDoc(); onClose(); },
    },
    {
      id: 'upload', kind: 'action', Icon: Upload,
      label: '匯入文件', sub: 'PDF · Markdown · TXT',
      iconBg: '#f0ebfe', iconColor: '#7c3aed',
      onSelect: () => { onUpload(); onClose(); },
    },
    {
      id: 'ai', kind: 'action', Icon: Sparkles,
      label: '開啟 AI 助手', sub: '對話 · GraphRAG · 代理',
      iconBg: '#e4f5ed', iconColor: '#0a7a4c',
      onSelect: () => { onOpenAI(); onClose(); },
    },
  ];

  const q = query.toLowerCase();
  const docItems: Item[] = documents
    .filter(d => !q || d.title.toLowerCase().includes(q))
    .slice(0, 7)
    .map(d => ({
      id: d.id,
      kind: 'doc',
      Icon: FileText,
      label: d.title,
      sub: d.updatedAt ? `已編輯 ${new Date(d.updatedAt).toLocaleDateString('zh-TW')}` : '文件',
      iconBg: 'var(--color-surface-tertiary)',
      iconColor: 'var(--color-text-tertiary)',
      onSelect: () => { onSelectDoc(d); onClose(); },
    }));

  const actionItems = q
    ? staticActions.filter(a => a.label.includes(q) || (a.sub ?? '').toLowerCase().includes(q))
    : staticActions;

  const items: Item[] = q
    ? [...docItems, ...actionItems]
    : [...actionItems, ...docItems];

  const clamped = Math.min(cursor, Math.max(0, items.length - 1));

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, items.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === 'Enter')     { e.preventDefault(); items[clamped]?.onSelect(); }
    if (e.key === 'Escape')    { onClose(); }
  }, [items, clamped, onClose]);

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
            <div
              className="rounded-2xl overflow-hidden flex flex-col"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                boxShadow: 'var(--shadow-spotlight)',
                maxHeight: '62vh',
              }}
            >
              {/* ── Search input ──────────────────────────────── */}
              <div
                className="flex items-center gap-3 px-4"
                style={{ height: 54, borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}
              >
                <Search size={16} style={{ color: 'var(--color-text-quaternary)', flexShrink: 0 }} />
                <input
                  autoFocus
                  value={query}
                  onChange={e => { setQuery(e.target.value); setCursor(0); }}
                  onKeyDown={handleKeyDown}
                  placeholder="搜尋文件或動作..."
                  className="flex-1 bg-transparent outline-none"
                  style={{ fontSize: 15, color: 'var(--color-text-primary)', caretColor: 'var(--color-accent)' }}
                />
                {query ? (
                  <button
                    onClick={() => setQuery('')}
                    className="flex items-center justify-center w-5 h-5 rounded-full transition-colors"
                    style={{ background: 'var(--color-surface-tertiary)', color: 'var(--color-text-tertiary)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-border)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-surface-tertiary)')}
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

              {/* ── Results ───────────────────────────────────── */}
              <div className="overflow-y-auto flex-1 py-1.5">
                {items.length === 0 ? (
                  <div className="px-4 py-10 text-center" style={{ color: 'var(--color-text-tertiary)', fontSize: 13 }}>
                    找不到「{query}」相關結果
                  </div>
                ) : (
                  <>
                    {!q && (
                      <SectionLabel label="動作" />
                    )}

                    {items.map((item, i) => {
                      const showDocSep = !q && i === staticActions.length && docItems.length > 0;
                      const isActive = i === clamped;
                      return (
                        <React.Fragment key={item.id}>
                          {showDocSep && (
                            <>
                              <div style={{ height: 1, background: 'var(--color-border)', margin: '4px 0' }} />
                              <SectionLabel label="最近文件" />
                            </>
                          )}
                          <button
                            onClick={item.onSelect}
                            onMouseEnter={() => setCursor(i)}
                            className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors mx-0"
                            style={{
                              background: isActive ? 'var(--color-surface-secondary)' : 'transparent',
                              borderRadius: 0,
                            }}
                          >
                            {/* Icon badge */}
                            <div
                              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
                              style={{ background: item.iconBg }}
                            >
                              <item.Icon size={13} style={{ color: item.iconColor }} />
                            </div>

                            {/* Text */}
                            <div className="flex-1 min-w-0">
                              <p
                                className="truncate"
                                style={{ fontSize: 13.5, color: 'var(--color-text-primary)', fontWeight: isActive ? 500 : 400, lineHeight: '18px' }}
                              >
                                {item.label}
                              </p>
                              {item.sub && (
                                <p className="truncate" style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', lineHeight: '15px' }}>
                                  {item.sub}
                                </p>
                              )}
                            </div>

                            {/* Arrow */}
                            <AnimatePresence>
                              {isActive && (
                                <motion.span
                                  initial={{ opacity: 0, x: -4 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  exit={{ opacity: 0, x: -4 }}
                                  transition={{ duration: 0.1 }}
                                >
                                  <ArrowRight size={12} style={{ color: 'var(--color-text-quaternary)', flexShrink: 0 }} />
                                </motion.span>
                              )}
                            </AnimatePresence>
                          </button>
                        </React.Fragment>
                      );
                    })}
                  </>
                )}
              </div>

              {/* ── Footer ────────────────────────────────────── */}
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
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <p
      className="px-4 py-1"
      style={{ fontSize: 10.5, color: 'var(--color-text-quaternary)', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}
    >
      {label}
    </p>
  );
}
