import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { renderMarkdown } from '../lib/markdownRenderer';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles, Share2, MoreHorizontal, Save, Eye, EyeOff,
  Download, CheckCircle2, History, MessageSquare, X, CornerDownLeft,
} from 'lucide-react';
import {
  listWorkspaceMembers,
  updateDocumentQueued,
  listCommentThreads,
  createCommentThreadQueued,
  createCommentQueued,
  resolveCommentThreadQueued,
  reopenCommentThreadQueued,
  onOfflineQueueReplay,
  type CommentAnchor,
  type CommentThread,
} from '../api/client';
import ShareModal from './ShareModal';
import BacklinksPanel from './BacklinksPanel';

interface Doc { id: string; title: string; content?: string; updatedAt?: string; }

interface Props {
  doc: any;
  workspaceId?: string;
  onOpenAI?: (prompt?: string) => void;
  focusThreadId?: string | null;
  onFocusThreadHandled?: () => void;
  documents?: Doc[];
  onNavigateDoc?: (docId: string) => void;
}

// ── Block Commands ──────────────────────────────────────────────────────────
const BLOCK_COMMANDS = [
  { icon: '📝', label: 'Text',       desc: '普通段落文字',   prefix: '' },
  { icon: 'H1', label: 'H1 大標題',  desc: '',               prefix: '# ' },
  { icon: 'H2', label: 'H2 中標題',  desc: '',               prefix: '## ' },
  { icon: 'H3', label: 'H3 小標題',  desc: '',               prefix: '### ' },
  { icon: '☑',  label: '待辦事項',   desc: 'To-do list',    prefix: '- [ ] ' },
  { icon: '•',  label: '項目列表',   desc: 'Bullet list',   prefix: '- ' },
  { icon: '1.', label: '有序列表',   desc: 'Numbered list', prefix: '1. ' },
  { icon: '❮❯', label: '程式碼區塊', desc: 'Code block',    prefix: '```\n', suffix: '\n```' },
  { icon: '❝',  label: '引言',       desc: 'Quote',         prefix: '> ' },
  { icon: '—',  label: '分隔線',     desc: 'Divider',       prefix: '\n---\n' },
  // ── 新 Block 類型 ──────────────────────────────────────────────────────
  { icon: 'ℹ️', label: 'Callout · 提示',    desc: '藍色提示框',   prefix: '> [!NOTE]\n> ' },
  { icon: '💡', label: 'Callout · 技巧',    desc: '綠色技巧框',   prefix: '> [!TIP]\n> ' },
  { icon: '⚠️', label: 'Callout · 警告',    desc: '黃色警告框',   prefix: '> [!WARNING]\n> ' },
  { icon: '📌', label: 'Callout · 重要',    desc: '紫色重要框',   prefix: '> [!IMPORTANT]\n> ' },
  { icon: '🔥', label: 'Callout · 危險',    desc: '紅色危險框',   prefix: '> [!CAUTION]\n> ' },
  { icon: '▶',  label: 'Toggle 折疊區塊',   desc: '點擊展開內容', prefix: '> [!TOGGLE] 標題\n> ' },
  { icon: '∑',  label: 'Math 區塊公式',     desc: 'KaTeX 區塊',   prefix: '$$\n', suffix: '\n$$' },
  { icon: 'λ',  label: 'Math 行內公式',     desc: 'KaTeX 行內',   prefix: '$', suffix: '$' },
  // ── AI 動作 ────────────────────────────────────────────────────────────
  { icon: '🧠', label: 'AI 續寫',    desc: '讓 AI 幫你繼續',  prefix: '__AI_CONTINUE__' },
  { icon: '📊', label: 'AI 摘要',    desc: '讓 AI 摘要文件',  prefix: '__AI_SUMMARIZE__' },
  { icon: '🌐', label: 'AI 翻譯',    desc: '翻譯為英文',       prefix: '__AI_TRANSLATE__' },
];

// ── AI Selection Popover ────────────────────────────────────────────────────
interface SelectionPopoverProps {
  visible: boolean;
  position: { x: number; y: number };
  selectedText: string;
  onAsk: (prompt: string) => void;
  onInlineAI: (prompt: string, mode: 'inline') => void;
  onComment: () => void;
  onClose: () => void;
}

const AI_ACTIONS = [
  { label: '解釋',  inline: true,  prompt: (t: string) => `解釋以下內容：\n\n${t}` },
  { label: '改寫',  inline: true,  prompt: (t: string) => `改寫以下內容，使其更清晰：\n\n${t}` },
  { label: '摘要',  inline: true,  prompt: (t: string) => `用 3 點摘要以下內容：\n\n${t}` },
  { label: '翻譯',  inline: true,  prompt: (t: string) => `將以下內容翻譯成英文：\n\n${t}` },
  { label: '問 AI ›', inline: false, prompt: (t: string) => `關於「${t.slice(0, 60)}」，` },
];

function SelectionPopover({ visible, position, selectedText, onAsk, onInlineAI, onComment, onClose }: SelectionPopoverProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 4 }}
          transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
          className="fixed z-50 flex items-center gap-0.5 p-1 rounded-xl"
          style={{
            left: position.x, top: position.y,
            transform: 'translate(-50%, -100%)',
            background: '#1a1a2e',
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
          }}
        >
          <div className="flex items-center gap-1 px-2 py-1 flex-shrink-0" style={{ color: '#7c86ff', fontSize: 11, fontWeight: 500 }}>
            <Sparkles size={11} /> AI
          </div>
          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.15)', flexShrink: 0 }} />
          {AI_ACTIONS.map(action => (
            <button
              key={action.label}
              onClick={() => {
                if (action.inline) onInlineAI(action.prompt(selectedText), 'inline');
                else onAsk(action.prompt(selectedText));
                onClose();
              }}
              className="px-2.5 py-1 rounded-lg transition-colors"
              style={{ fontSize: 12, color: '#e0e0f0', whiteSpace: 'nowrap' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {action.label}
            </button>
          ))}
          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.15)', flexShrink: 0, margin: '0 4px' }} />
          <button
            onClick={() => { onComment(); onClose(); }}
            className="px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1"
            style={{ fontSize: 12, color: '#e0e0f0', whiteSpace: 'nowrap' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <MessageSquare size={12} /> 留言
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface WorkspaceMember {
  user_id: string;
  name: string;
  email: string;
  role: string;
}

function extractMentionToken(text: string, cursor: number) {
  const prefix = text.slice(0, cursor);
  const atIndex = prefix.lastIndexOf('@');
  if (atIndex < 0) return null;
  if (atIndex > 0 && !/\s/.test(prefix[atIndex - 1])) return null;
  const token = prefix.slice(atIndex + 1);
  if (token.includes(' ') || token.includes('\n')) return null;
  return { start: atIndex, end: cursor, query: token.toLowerCase() };
}

function countMentions(text: string, members: WorkspaceMember[]): number {
  const tokens = new Set<string>();
  const regex = /@([^\s()[\]{}<>]+)/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(text)) !== null) {
    const token = match[1].replace(/[)\]}>,!?;:]+$/g, '').toLowerCase();
    if (token) tokens.add(token);
  }
  if (tokens.size === 0) return 0;
  let count = 0;
  for (const member of members) {
    const email = member.email.toLowerCase();
    const name = member.name.toLowerCase();
    const snake = name.replace(/\s+/g, '_');
    const local = email.split('@')[0];
    if ([email, name, snake, local].some((value) => tokens.has(value))) {
      count += 1;
    }
  }
  return count;
}

function MentionInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  members,
  submitting,
  buttonLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  members: WorkspaceMember[];
  submitting?: boolean;
  buttonLabel?: string;
}) {
  const [mentionState, setMentionState] = useState<{ start: number; end: number; query: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = mentionState
    ? members
        .filter((member) => {
          if (!mentionState.query) return true;
          const q = mentionState.query;
          return (
            member.name.toLowerCase().includes(q) ||
            member.email.toLowerCase().includes(q)
          );
        })
        .slice(0, 6)
    : [];

  useEffect(() => {
    setActiveIndex(0);
  }, [mentionState?.query]);

  const applyMention = (member: WorkspaceMember) => {
    if (!mentionState) return;
    const cursor = inputRef.current?.selectionStart ?? mentionState.end;
    const snakeName = member.name.trim().toLowerCase().replace(/\s+/g, '_');
    const mentionToken = snakeName || member.email.toLowerCase().split('@')[0];
    const mentionText = `@${mentionToken} `;
    const nextValue = value.slice(0, mentionState.start) + mentionText + value.slice(cursor);
    const nextCursor = mentionState.start + mentionText.length;
    onChange(nextValue);
    setMentionState(null);
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      inputRef.current.focus();
      inputRef.current.selectionStart = nextCursor;
      inputRef.current.selectionEnd = nextCursor;
    });
  };

  const mentionCount = countMentions(value, members);

  return (
    <div className="space-y-2">
      <div className="relative">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => {
            const nextValue = e.target.value;
            onChange(nextValue);
            const token = extractMentionToken(nextValue, e.target.selectionStart);
            setMentionState(token);
          }}
          onKeyDown={(e) => {
            if (mentionState && suggestions.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const member = suggestions[activeIndex];
                if (member) applyMention(member);
                return;
              }
              if (e.key === 'Escape') {
                setMentionState(null);
                return;
              }
            }

            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={placeholder}
          rows={3}
          className="w-full resize-y bg-surface-secondary border border-border rounded-lg px-3 py-2 text-xs text-text-primary outline-none focus:ring-1 focus:ring-accent"
        />
        {mentionState && suggestions.length > 0 && (
          <div
            className="absolute left-0 right-0 mt-1 rounded-lg border border-border bg-surface shadow-lg z-20 overflow-hidden"
          >
            {suggestions.map((member, idx) => (
              <button
                key={member.user_id}
                onClick={() => applyMention(member)}
                className="w-full px-3 py-2 text-left text-xs transition-colors"
                style={{
                  background: idx === activeIndex ? 'var(--color-accent-light)' : 'transparent',
                  color: idx === activeIndex ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                }}
              >
                <span className="font-medium">{member.name}</span>
                <span className="ml-2 text-text-tertiary">{member.email}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-text-tertiary">
          輸入 @ 提及成員
          {mentionCount > 0 ? ` · 已提及 ${mentionCount} 人` : ''}
        </span>
        <button
          onClick={onSubmit}
          disabled={submitting || !value.trim()}
          className="px-2.5 py-1.5 bg-accent text-white text-xs rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-40"
        >
          {buttonLabel ?? '送出'}
        </button>
      </div>
    </div>
  );
}

// ── Slash Command Menu ──────────────────────────────────────────────────────
interface SlashMenuProps {
  visible: boolean;
  x: number;
  y: number;
  filter: string;
  selectedIndex: number;
  onSelect: (cmd: typeof BLOCK_COMMANDS[0]) => void;
  onClose: () => void;
}

function SlashMenu({ visible, x, y, filter, selectedIndex, onSelect, onClose }: SlashMenuProps) {
  const filtered = BLOCK_COMMANDS.filter(c =>
    c.label.toLowerCase().includes(filter.toLowerCase()) ||
    c.desc.toLowerCase().includes(filter.toLowerCase())
  );
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      const item = listRef.current.children[selectedIndex] as HTMLElement;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  return (
    <AnimatePresence>
      {visible && filtered.length > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -5 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -5 }}
          transition={{ duration: 0.12 }}
          className="fixed z-50 rounded-xl overflow-hidden flex flex-col"
          style={{
            left: x, top: y, width: 280, maxHeight: 340,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <div className="px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <p style={{ fontSize: 10.5, color: 'var(--color-text-quaternary)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {filter ? `「${filter}」` : 'Block 類型'}
            </p>
          </div>
          <div ref={listRef} className="overflow-y-auto py-1">
            {filtered.map((cmd, i) => (
              <button
                key={cmd.label}
                onMouseDown={e => { e.preventDefault(); onSelect(cmd); }}
                className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors"
                style={{
                  background: i === selectedIndex ? 'var(--color-accent-light)' : 'transparent',
                  color: i === selectedIndex ? 'var(--color-accent)' : 'var(--color-text-primary)',
                }}
                onMouseEnter={e => { if (i !== selectedIndex) e.currentTarget.style.background = 'var(--color-surface-secondary)'; }}
                onMouseLeave={e => { if (i !== selectedIndex) e.currentTarget.style.background = 'transparent'; }}
              >
                <span
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'var(--color-surface-tertiary)', fontSize: cmd.icon.length > 2 ? 11 : 16, fontWeight: 700, color: 'var(--color-text-secondary)' }}
                >
                  {cmd.icon}
                </span>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 500 }}>{cmd.label}</p>
                  {cmd.desc && <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{cmd.desc}</p>}
                </div>
              </button>
            ))}
          </div>
          <div className="px-3 py-1.5 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-muted)' }}>
            <p style={{ fontSize: 10, color: 'var(--color-text-quaternary)' }}>↑↓ 選擇 · Enter 確認 · Esc 關閉</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Wiki-link [[ Menu ────────────────────────────────────────────────────────
interface WikiLinkMenuProps {
  visible: boolean; x: number; y: number;
  query: string; selectedIndex: number;
  documents: { id: string; title: string }[];
  onSelect: (title: string) => void;
  onClose: () => void;
}

function WikiLinkMenu({ visible, x, y, query, selectedIndex, documents, onSelect, onClose }: WikiLinkMenuProps) {
  const filtered = documents
    .filter(d => !query || d.title.toLowerCase().includes(query))
    .slice(0, 8);

  return (
    <AnimatePresence>
      {visible && filtered.length > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -5 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -5 }}
          transition={{ duration: 0.12 }}
          className="fixed z-50 rounded-xl overflow-hidden flex flex-col"
          style={{ left: x, top: y, width: 260, maxHeight: 280, background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' }}
        >
          <div className="px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <p style={{ fontSize: 10.5, color: 'var(--color-text-quaternary)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              連結至頁面
            </p>
          </div>
          <div className="overflow-y-auto py-1">
            {filtered.map((doc, i) => (
              <button
                key={doc.id}
                onMouseDown={e => { e.preventDefault(); onSelect(doc.title); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
                style={{ background: i === selectedIndex ? 'var(--color-accent-light)' : 'transparent', color: i === selectedIndex ? 'var(--color-accent)' : 'var(--color-text-primary)' }}
                onMouseEnter={e => { if (i !== selectedIndex) e.currentTarget.style.background = 'var(--color-surface-secondary)'; }}
                onMouseLeave={e => { if (i !== selectedIndex) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ fontSize: 13 }}>📄</span>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{doc.title}</span>
              </button>
            ))}
          </div>
          <div className="px-3 py-1.5 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-muted)' }}>
            <p style={{ fontSize: 10, color: 'var(--color-text-quaternary)' }}>↑↓ 選擇 · Enter 插入 · Esc 關閉</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Inline AI Block ─────────────────────────────────────────────────────────
interface InlineAIProps {
  visible: boolean;
  x: number;
  y: number;
  initialPrompt?: string;
  workspaceId?: string;
  onInsert: (text: string) => void;
  onClose: () => void;
}

function InlineAIBlock({ visible, x, y, initialPrompt, workspaceId, onInsert, onClose }: InlineAIProps) {
  const [prompt, setPrompt] = useState(initialPrompt ?? '');
  const [result, setResult] = useState('');
  const [streaming, setStreaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (visible) {
      setPrompt(initialPrompt ?? '');
      setResult('');
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [visible, initialPrompt]);

  const handleStream = useCallback(() => {
    if (!prompt.trim() || streaming) return;
    setResult('');
    setStreaming(true);
    esRef.current?.close();

    const token = localStorage.getItem('auth_token');
    const base = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
    const url = `${base}/api/v1/ai/stream?prompt=${encodeURIComponent(prompt)}${token ? `&token=${token}` : ''}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = e => {
      try {
        const d = JSON.parse(e.data);
        if (d.token) setResult(prev => prev + d.token);
      } catch {}
    };
    es.addEventListener('done', () => { setStreaming(false); es.close(); });
    es.onerror = () => { setStreaming(false); es.close(); };
  }, [prompt, streaming]);

  useEffect(() => {
    if (visible && initialPrompt) handleStream();
  }, [visible]); // eslint-disable-line

  useEffect(() => () => esRef.current?.close(), []);

  const clampedX = Math.min(x, window.innerWidth - 340);
  const clampedY = Math.min(y, window.innerHeight - 300);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -4 }}
          transition={{ duration: 0.14 }}
          className="fixed z-50 flex flex-col rounded-2xl overflow-hidden"
          style={{
            left: clampedX, top: clampedY, width: 340,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-xl)',
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <Sparkles size={14} style={{ color: 'var(--color-ai)' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', flex: 1 }}>Inline AI</span>
            <button onClick={onClose} style={{ color: 'var(--color-text-tertiary)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
            ><X size={14} /></button>
          </div>

          {/* Prompt input */}
          <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <input
              ref={inputRef}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleStream(); }
                if (e.key === 'Escape') onClose();
              }}
              placeholder="輸入 prompt，Enter 送出..."
              className="flex-1 outline-none bg-transparent"
              style={{ fontSize: 13, color: 'var(--color-text-primary)', caretColor: 'var(--color-accent)' }}
            />
            <button
              onClick={handleStream}
              disabled={streaming || !prompt.trim()}
              className="w-6 h-6 flex items-center justify-center rounded-md transition-colors flex-shrink-0"
              style={{
                background: streaming || !prompt.trim() ? 'var(--color-surface-tertiary)' : 'linear-gradient(135deg, var(--color-accent), var(--color-ai))',
                color: streaming || !prompt.trim() ? 'var(--color-text-quaternary)' : 'white',
              }}
            >
              {streaming
                ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                : <CornerDownLeft size={12} />
              }
            </button>
          </div>

          {/* Result */}
          {result && (
            <div className="px-3 py-2.5 overflow-y-auto" style={{ maxHeight: 180, background: 'var(--color-surface-muted)' }}>
              <p style={{ fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{result}</p>
            </div>
          )}

          {/* Actions */}
          {result && !streaming && (
            <div className="flex gap-2 px-3 py-2" style={{ borderTop: '1px solid var(--color-border)' }}>
              <button
                onClick={() => { onInsert(result); onClose(); }}
                className="flex-1 py-1.5 rounded-lg text-white transition-opacity"
                style={{ fontSize: 12, fontWeight: 500, background: 'linear-gradient(135deg, var(--color-accent), var(--color-ai))' }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                插入到文件
              </button>
              <button
                onClick={() => { setResult(''); setPrompt(''); inputRef.current?.focus(); }}
                className="px-3 py-1.5 rounded-lg transition-colors"
                style={{ fontSize: 12, color: 'var(--color-text-secondary)', background: 'var(--color-surface-tertiary)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-border)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-surface-tertiary)')}
              >
                重試
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Toolbar helpers ──────────────────────────────────────────────────────────
function ToolbarBtn({ children, onClick, title, active, disabled }: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-7 h-7 flex items-center justify-center rounded-md transition-colors flex-shrink-0"
      style={{
        color: active ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
        background: active ? 'var(--color-accent-light)' : 'transparent',
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={e => { if (!active && !disabled) { e.currentTarget.style.background = 'var(--color-surface-tertiary)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; } }}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-tertiary)'; } }}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <div style={{ width: 1, height: 18, background: 'var(--color-border)', flexShrink: 0, margin: '0 2px' }} />;
}

// ── Main Editor ─────────────────────────────────────────────────────────────
export default function Editor({ doc, workspaceId, onOpenAI, focusThreadId, onFocusThreadHandled, documents = [], onNavigateDoc }: Props) {
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [connected, setConnected] = useState(false);
  const [preview, setPreview] = useState(false);

  // Selection popover
  const [popover, setPopover] = useState<{ visible: boolean; x: number; y: number; text: string }>({
    visible: false, x: 0, y: 0, text: '',
  });

  // Slash command menu
  const [slashMenu, setSlashMenu] = useState<{ visible: boolean; x: number; y: number; filter: string; selectedIndex: number; slashStart: number }>({
    visible: false, x: 0, y: 0, filter: '', selectedIndex: 0, slashStart: -1,
  });

  // Wiki-link autocomplete ([[)
  const [wikiMenu, setWikiMenu] = useState<{ visible: boolean; x: number; y: number; query: string; selectedIndex: number; bracketStart: number }>({
    visible: false, x: 0, y: 0, query: '', selectedIndex: 0, bracketStart: -1,
  });

  // Inline AI
  const [inlineAI, setInlineAI] = useState<{ visible: boolean; x: number; y: number; prompt: string }>({
    visible: false, x: 0, y: 0, prompt: '',
  });

  // Panels
  const [showHistory, setShowHistory] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [commentThreads, setCommentThreads] = useState<CommentThread[]>([]);
  const [threadFilter, setThreadFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [threadComposer, setThreadComposer] = useState<{ selectedText: string; anchor: Partial<CommentAnchor> | null } | null>(null);
  const [threadBody, setThreadBody] = useState('');
  const [threadSubmitting, setThreadSubmitting] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replySubmitting, setReplySubmitting] = useState<Record<string, boolean>>({});
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  // Sync connection
  useEffect(() => {
    if (!doc) return;
    providerRef.current?.destroy();
    ydocRef.current?.destroy();
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    const yText = ydoc.getText('content');
    const provider = new HocuspocusProvider({
      url: import.meta.env.VITE_SYNC_URL ?? 'ws://localhost:1234',
      name: doc.id,
      document: ydoc,
      onConnect() { setConnected(true); },
      onDisconnect() { setConnected(false); },
    });
    providerRef.current = provider;
    const observer = () => {
      const txt = yText.toString();
      setContent(txt);
      if (textareaRef.current && document.activeElement !== textareaRef.current) {
        textareaRef.current.value = txt;
      }
    };
    yText.observe(observer);
    return () => { yText.unobserve(observer); provider.destroy(); ydoc.destroy(); };
  }, [doc?.id]);

  const applyContent = useCallback((val: string) => {
    setContent(val);
    setSaved(false);
    if (textareaRef.current) textareaRef.current.value = val;
    const yText = ydocRef.current?.getText('content');
    if (yText) {
      ydocRef.current!.transact(() => { yText.delete(0, yText.length); yText.insert(0, val); });
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => handleSave(val), 2000);
  }, [doc]);

  const handleChange = useCallback((val: string) => {
    applyContent(val);
  }, [applyContent]);

  const handleSave = useCallback(async (val?: string) => {
    if (!doc || !workspaceId) return;
    setSaving(true);
    try {
      const result = await updateDocumentQueued(doc.id, {
        title: doc.title,
        content: { text: val ?? contentRef.current },
      });
      if (result.queued) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error('儲存失敗', err);
    } finally {
      setSaving(false);
    }
  }, [doc, workspaceId]);

  const loadCommentThreads = useCallback(async (status: 'open' | 'resolved' | 'all' = threadFilter) => {
    if (!doc?.id) return;
    setThreadsLoading(true);
    try {
      const { threads } = await listCommentThreads(doc.id, status);
      setCommentThreads(threads.map((thread) => ({ ...thread, sync_status: 'synced' })));
    } catch (error) {
      console.error('載入留言失敗', error);
    } finally {
      setThreadsLoading(false);
    }
  }, [doc?.id, threadFilter]);

  const loadWorkspaceMembers = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const { members } = await listWorkspaceMembers(workspaceId);
      setWorkspaceMembers(members);
    } catch (error) {
      console.error('載入成員失敗', error);
    }
  }, [workspaceId]);

  const focusThreadAnchor = useCallback((thread: CommentThread) => {
    setSelectedThreadId(thread.id);
    const anchor = thread.anchor;
    const ta = textareaRef.current;
    if (!anchor || !ta) return;
    const start = Number(anchor.start_offset ?? 0);
    const end = Number(anchor.end_offset ?? start);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    ta.focus();
    ta.setSelectionRange(start, end);
    const before = ta.value.slice(0, start);
    const lineCount = before.split('\n').length;
    const estimatedLineHeight = 26;
    ta.scrollTop = Math.max(0, lineCount * estimatedLineHeight - estimatedLineHeight * 3);
  }, []);

  const openThreadComposerFromSelection = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? start;
    const selectedText = ta.value.slice(start, end).trim();
    if (!selectedText) return;
    const contextBefore = ta.value.slice(Math.max(0, start - 80), start);
    const contextAfter = ta.value.slice(end, Math.min(ta.value.length, end + 80));
    setShowComments(true);
    setThreadComposer({
      selectedText,
      anchor: {
        start_offset: start,
        end_offset: end,
        selected_text: selectedText,
        context_before: contextBefore,
        context_after: contextAfter,
      },
    });
    setThreadBody('');
  }, []);

  const handleCreateThread = useCallback(async () => {
    if (!doc?.id || !threadBody.trim()) return;
    setThreadSubmitting(true);
    try {
      const result = await createCommentThreadQueued(doc.id, {
        body_markdown: threadBody.trim(),
        anchor: threadComposer?.anchor ?? undefined,
      });
      if (result.queued || !result.data) {
        const temporaryId = `queued-${result.idempotency_key}`;
        const optimisticThread: CommentThread = {
          id: temporaryId,
          workspace_id: workspaceId ?? '',
          document_id: doc.id,
          status: 'open',
          created_by: 'me',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          anchor: threadComposer?.anchor
            ? {
                id: `queued-anchor-${result.idempotency_key}`,
                thread_id: temporaryId,
                start_offset: Number(threadComposer.anchor.start_offset ?? 0),
                end_offset: Number(threadComposer.anchor.end_offset ?? 0),
                block_id: threadComposer.anchor.block_id ?? null,
                yjs_relative_start: threadComposer.anchor.yjs_relative_start ?? null,
                yjs_relative_end: threadComposer.anchor.yjs_relative_end ?? null,
                selected_text: threadComposer.anchor.selected_text ?? null,
                context_before: threadComposer.anchor.context_before ?? null,
                context_after: threadComposer.anchor.context_after ?? null,
              }
            : null,
          comments: [
            {
              id: `queued-comment-${result.idempotency_key}`,
              thread_id: temporaryId,
              body_markdown: threadBody.trim(),
              created_by: 'me',
              created_by_name: '你',
              created_at: new Date().toISOString(),
              mention_count: 0,
            },
          ],
          sync_status: 'queued',
        };
        setCommentThreads((prev) => [optimisticThread, ...prev]);
      } else {
        setCommentThreads((prev) => [{ ...result.data.thread, sync_status: 'synced' }, ...prev]);
        focusThreadAnchor(result.data.thread);
      }
      setThreadBody('');
      setThreadComposer(null);
    } catch (error) {
      console.error('建立留言串失敗', error);
    } finally {
      setThreadSubmitting(false);
    }
  }, [doc?.id, focusThreadAnchor, threadBody, threadComposer, workspaceId]);

  const handleReplyThread = useCallback(async (threadId: string) => {
    const body = replyDrafts[threadId]?.trim();
    if (!body) return;
    setReplySubmitting((prev) => ({ ...prev, [threadId]: true }));
    try {
      const result = await createCommentQueued(threadId, { body_markdown: body });
      const nextComment = result.queued || !result.data
        ? {
            id: `queued-comment-${result.idempotency_key}`,
            thread_id: threadId,
            body_markdown: body,
            created_by: 'me',
            created_by_name: '你',
            created_at: new Date().toISOString(),
            mention_count: 0,
          }
        : result.data.comment;
      setCommentThreads((prev) =>
        prev.map((thread) =>
          thread.id === threadId
            ? { ...thread, comments: [...thread.comments, nextComment], sync_status: result.queued ? 'queued' : thread.sync_status }
            : thread
        )
      );
      setReplyDrafts((prev) => ({ ...prev, [threadId]: '' }));
    } catch (error) {
      console.error('新增回覆失敗', error);
    } finally {
      setReplySubmitting((prev) => ({ ...prev, [threadId]: false }));
    }
  }, [replyDrafts]);

  const handleToggleThreadStatus = useCallback(async (thread: CommentThread) => {
    try {
      if (thread.status === 'open') {
        const result = await resolveCommentThreadQueued(thread.id);
        if (result.queued || !result.data) {
          setCommentThreads((prev) =>
            prev.map((item) =>
              item.id === thread.id
                ? { ...item, status: 'resolved', resolved_at: new Date().toISOString(), sync_status: 'queued' }
                : item
            )
          );
        } else {
          setCommentThreads((prev) =>
            prev.map((item) =>
              item.id === thread.id
                ? { ...item, ...result.data?.thread, sync_status: 'synced' }
                : item
            )
          );
        }
      } else {
        const result = await reopenCommentThreadQueued(thread.id);
        if (result.queued || !result.data) {
          setCommentThreads((prev) =>
            prev.map((item) =>
              item.id === thread.id
                ? { ...item, status: 'open', resolved_at: null, sync_status: 'queued' }
                : item
            )
          );
        } else {
          setCommentThreads((prev) =>
            prev.map((item) =>
              item.id === thread.id
                ? { ...item, ...result.data?.thread, sync_status: 'synced' }
                : item
            )
          );
        }
      }
      if (threadFilter !== 'all') {
        await loadCommentThreads(threadFilter);
      }
    } catch (error) {
      console.error('更新留言狀態失敗', error);
    }
  }, [loadCommentThreads, threadFilter]);

  // Cmd+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); handleSave(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  useEffect(() => {
    if (!showComments || !doc?.id) return;
    loadCommentThreads();
  }, [showComments, doc?.id, threadFilter, loadCommentThreads]);

  useEffect(() => {
    setThreadComposer(null);
    setThreadBody('');
    setCommentThreads([]);
    setReplyDrafts({});
    setSelectedThreadId(null);
  }, [doc?.id]);

  useEffect(() => {
    if (!showComments || !workspaceId) return;
    loadWorkspaceMembers();
  }, [showComments, workspaceId, loadWorkspaceMembers]);

  useEffect(() => {
    if (!focusThreadId) return;
    setShowComments(true);
    setThreadFilter('all');
    setSelectedThreadId(focusThreadId);
  }, [focusThreadId]);

  useEffect(() => {
    if (!focusThreadId || threadsLoading) return;
    const thread = commentThreads.find((item) => item.id === focusThreadId);
    if (thread) {
      focusThreadAnchor(thread);
    }
    onFocusThreadHandled?.();
  }, [commentThreads, focusThreadAnchor, focusThreadId, onFocusThreadHandled, threadsLoading]);

  useEffect(() => {
    const unsubscribe = onOfflineQueueReplay((result) => {
      if (result.failed > 0) {
        setCommentThreads((prev) =>
          prev.map((thread) =>
            thread.sync_status === 'queued'
              ? { ...thread, sync_status: 'failed' }
              : thread
          )
        );
      }
      if (result.processed > 0 && showComments) {
        loadCommentThreads();
      }
    });
    return unsubscribe;
  }, [loadCommentThreads, showComments]);

  // Text selection → AI popover
  const handleSelect = useCallback(() => {
    if (preview) return;
    const ta = textareaRef.current;
    if (ta && document.activeElement === ta && ta.selectionStart !== ta.selectionEnd) {
      const text = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
      if (!text) {
        setPopover((p) => ({ ...p, visible: false }));
        return;
      }
      const rect = ta.getBoundingClientRect();
      setPopover({
        visible: true,
        x: rect.left + rect.width / 2,
        y: rect.top + 48,
        text,
      });
      return;
    }

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      setPopover((p) => ({ ...p, visible: false }));
      return;
    }
    const text = sel.toString().trim();
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    setPopover({ visible: true, x: rect.left + rect.width / 2, y: rect.top - 8, text });
  }, [preview]);

  // Close popover on click-away
  useEffect(() => {
    const handler = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setPopover(p => ({ ...p, visible: false }));
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Insert text at cursor in textarea
  const insertAtCursor = useCallback((before: string, after = '') => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const old = ta.value;
    const newVal = old.slice(0, start) + before + old.slice(end) + after;
    applyContent(newVal);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + before.length;
      ta.focus();
    });
  }, [applyContent]);

  // Replace the slash command + filter chars with block prefix
  const applyBlockCommand = useCallback((cmd: typeof BLOCK_COMMANDS[0], slashStart: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const old = ta.value;
    // Delete from slashStart to current cursor
    const cur = ta.selectionStart;
    const newVal = old.slice(0, slashStart) + cmd.prefix + old.slice(cur) + (cmd.suffix ?? '');
    applyContent(newVal);
    requestAnimationFrame(() => {
      const pos = slashStart + cmd.prefix.length;
      ta.selectionStart = ta.selectionEnd = pos;
      ta.focus();
    });
  }, [applyContent]);

  // Handle keyboard in textarea
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Navigate slash menu
    if (slashMenu.visible) {
      const filtered = BLOCK_COMMANDS.filter(c =>
        c.label.toLowerCase().includes(slashMenu.filter.toLowerCase()) ||
        c.desc.toLowerCase().includes(slashMenu.filter.toLowerCase())
      );
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashMenu(s => ({ ...s, selectedIndex: Math.min(s.selectedIndex + 1, filtered.length - 1) }));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashMenu(s => ({ ...s, selectedIndex: Math.max(s.selectedIndex - 1, 0) }));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered[slashMenu.selectedIndex];
        if (cmd) handleSlashSelect(cmd);
        return;
      }
      if (e.key === 'Escape') {
        setSlashMenu(s => ({ ...s, visible: false }));
        return;
      }
    }

    if (e.key === 'Escape') {
      setInlineAI(a => ({ ...a, visible: false }));
    }

    // ── Wiki-link [[… keyboard navigation ──────────────────────────────
    if (wikiMenu.visible) {
      const wikiFiltered = documents
        .filter(d => !wikiMenu.query || d.title.toLowerCase().includes(wikiMenu.query))
        .slice(0, 8);
      if (e.key === 'ArrowDown') { e.preventDefault(); setWikiMenu(s => ({ ...s, selectedIndex: Math.min(s.selectedIndex + 1, wikiFiltered.length - 1) })); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setWikiMenu(s => ({ ...s, selectedIndex: Math.max(s.selectedIndex - 1, 0) })); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        const picked = wikiFiltered[wikiMenu.selectedIndex];
        if (picked) applyWikiLink(picked.title);
        return;
      }
      if (e.key === 'Escape') { setWikiMenu(s => ({ ...s, visible: false })); return; }
    }
  }, [slashMenu, wikiMenu, documents]);

  // Handle input change — detect slash command
  const handleTextareaInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    handleChange(val);

    const ta = e.target;
    const cur = ta.selectionStart;
    // Find the last slash before cursor on this line
    const lineStart = val.lastIndexOf('\n', cur - 1) + 1;
    const lineBeforeCursor = val.slice(lineStart, cur);
    const slashIdx = lineBeforeCursor.lastIndexOf('/');

    if (slashIdx !== -1) {
      const filter = lineBeforeCursor.slice(slashIdx + 1);
      // Only show if filter is short and we just typed (no space in filter)
      if (!filter.includes(' ') && filter.length <= 15) {
        // Estimate y position using lineHeight
        const lineCount = val.slice(0, lineStart).split('\n').length;
        const lineHeight = 28; // approx px
        const taRect = ta.getBoundingClientRect();
        const scrollOffset = ta.scrollTop;
        const approxY = taRect.top + lineCount * lineHeight - scrollOffset + lineHeight + 4;
        const approxX = taRect.left + 40;

        setSlashMenu({
          visible: true,
          x: approxX,
          y: Math.min(approxY, window.innerHeight - 200),
          filter,
          selectedIndex: 0,
          slashStart: lineStart + slashIdx,
        });
        return;
      }
    }
    setSlashMenu(s => ({ ...s, visible: false }));

    // ── Wiki-link [[… detection ──────────────────────────────────────────
    const doubleBracket = val.lastIndexOf('[[', cur);
    if (doubleBracket !== -1 && doubleBracket >= cur - 40) {
      const query = val.slice(doubleBracket + 2, cur);
      if (!query.includes('\n') && !query.includes(']]')) {
        const lineCount2 = val.slice(0, doubleBracket).split('\n').length;
        const taRect2 = ta.getBoundingClientRect();
        const scrollOffset2 = ta.scrollTop;
        const approxY2 = taRect2.top + lineCount2 * 28 - scrollOffset2 + 28 + 4;
        setWikiMenu({
          visible: true,
          x: taRect2.left + 40,
          y: Math.min(approxY2, window.innerHeight - 200),
          query: query.toLowerCase(),
          selectedIndex: 0,
          bracketStart: doubleBracket,
        });
        return;
      }
    }
    setWikiMenu(s => ({ ...s, visible: false }));
  }, [handleChange]);

  const applyWikiLink = useCallback((title: string) => {
    setWikiMenu(s => ({ ...s, visible: false }));
    const ta = textareaRef.current;
    if (!ta) return;
    const cur = ta.selectionStart;
    const val = ta.value;
    const newVal = val.slice(0, wikiMenu.bracketStart) + `[[${title}]]` + val.slice(cur);
    applyContent(newVal);
    // Move cursor after the inserted link
    setTimeout(() => {
      const pos = wikiMenu.bracketStart + title.length + 4;
      ta.setSelectionRange(pos, pos);
    }, 0);
  }, [wikiMenu, applyContent]);

  const handleSlashSelect = useCallback((cmd: typeof BLOCK_COMMANDS[0]) => {
    setSlashMenu(s => ({ ...s, visible: false }));

    // AI commands
    if (cmd.prefix === '__AI_CONTINUE__') {
      const ta = textareaRef.current;
      const taRect = ta?.getBoundingClientRect();
      setInlineAI({ visible: true, x: (taRect?.left ?? 100) + 40, y: (taRect?.top ?? 200) + 120, prompt: '幫我繼續寫以下內容：\n\n' + contentRef.current.slice(0, 300) });
      // Remove the /xxx text
      if (ta) {
        const cur = ta.selectionStart;
        const old = ta.value;
        const newVal = old.slice(0, slashMenu.slashStart) + old.slice(cur);
        applyContent(newVal);
      }
      return;
    }
    if (cmd.prefix === '__AI_SUMMARIZE__') {
      const ta = textareaRef.current;
      const taRect = ta?.getBoundingClientRect();
      setInlineAI({ visible: true, x: (taRect?.left ?? 100) + 40, y: (taRect?.top ?? 200) + 120, prompt: '摘要以下文件內容：\n\n' + contentRef.current.slice(0, 800) });
      if (ta) {
        const cur = ta.selectionStart;
        const old = ta.value;
        const newVal = old.slice(0, slashMenu.slashStart) + old.slice(cur);
        applyContent(newVal);
      }
      return;
    }
    if (cmd.prefix === '__AI_TRANSLATE__') {
      const ta = textareaRef.current;
      const taRect = ta?.getBoundingClientRect();
      setInlineAI({ visible: true, x: (taRect?.left ?? 100) + 40, y: (taRect?.top ?? 200) + 120, prompt: '請將以下內容翻譯成英文：\n\n' + contentRef.current.slice(0, 800) });
      if (ta) {
        const cur = ta.selectionStart;
        const old = ta.value;
        const newVal = old.slice(0, slashMenu.slashStart) + old.slice(cur);
        applyContent(newVal);
      }
      return;
    }

    applyBlockCommand(cmd, slashMenu.slashStart);
  }, [slashMenu, applyBlockCommand, applyContent]);

  // Export helpers
  const exportMd = () => {
    if (!doc) return;
    const b = new Blob([`# ${doc.title}\n\n${content}`], { type: 'text/markdown' });
    const u = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = u; a.download = `${doc.title}.md`; a.click(); URL.revokeObjectURL(u);
  };

  // ── Empty state
  if (!doc) return (
    <div className="flex items-center justify-center h-full" style={{ background: 'var(--color-surface)' }}>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="text-center"
        style={{ maxWidth: 340 }}
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
          style={{ background: 'var(--color-surface-secondary)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}
        >
          <span style={{ fontSize: 30 }}>✦</span>
        </div>
        <p style={{ fontSize: 17, fontWeight: 650, color: 'var(--color-text-primary)', marginBottom: 8, letterSpacing: '-0.3px' }}>
          選擇一份文件開始
        </p>
        <p style={{ fontSize: 13.5, color: 'var(--color-text-tertiary)', lineHeight: 1.65, marginBottom: 20 }}>
          從左側選擇文件，或按下快速鍵來新增
        </p>
        <div className="flex items-center justify-center gap-2">
          <kbd style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, background: 'var(--color-surface-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontFamily: 'inherit', boxShadow: 'var(--shadow-xs)' }}>
            ⌘K
          </kbd>
          <span style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>開啟命令列</span>
        </div>
      </motion.div>
    </div>
  );

  return (
    <motion.div
      key={doc.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col h-full"
      style={{ background: 'var(--color-surface)' }}
    >
      {/* Selection AI Popover */}
      <SelectionPopover
        visible={popover.visible}
        position={{ x: popover.x, y: popover.y }}
        selectedText={popover.text}
        onAsk={(prompt) => onOpenAI?.(prompt)}
        onInlineAI={(prompt) => {
          const ta = textareaRef.current;
          const taRect = ta?.getBoundingClientRect();
          setInlineAI({ visible: true, x: (taRect?.left ?? 100) + 40, y: (taRect?.top ?? 200) + 120, prompt });
        }}
        onComment={openThreadComposerFromSelection}
        onClose={() => setPopover(p => ({ ...p, visible: false }))}
      />

      {/* Slash Command Menu */}
      <SlashMenu
        visible={slashMenu.visible}
        x={slashMenu.x}
        y={slashMenu.y}
        filter={slashMenu.filter}
        selectedIndex={slashMenu.selectedIndex}
        onSelect={handleSlashSelect}
        onClose={() => setSlashMenu(s => ({ ...s, visible: false }))}
      />

      {/* Wiki-link [[ Popup */}
      <WikiLinkMenu
        visible={wikiMenu.visible}
        x={wikiMenu.x}
        y={wikiMenu.y}
        query={wikiMenu.query}
        selectedIndex={wikiMenu.selectedIndex}
        documents={documents}
        onSelect={applyWikiLink}
        onClose={() => setWikiMenu(s => ({ ...s, visible: false }))}
      />

      {/* Inline AI Block */}
      <InlineAIBlock
        visible={inlineAI.visible}
        x={inlineAI.x}
        y={inlineAI.y}
        initialPrompt={inlineAI.prompt}
        workspaceId={workspaceId}
        onInsert={(text) => {
          const ta = textareaRef.current;
          if (ta) {
            const old = ta.value;
            const cur = ta.selectionStart;
            applyContent(old.slice(0, cur) + '\n\n' + text + '\n\n' + old.slice(cur));
          }
        }}
        onClose={() => setInlineAI(a => ({ ...a, visible: false }))}
      />

      {/* Top bar */}
      <div
        className="flex items-center gap-1.5 px-4 flex-shrink-0"
        style={{ height: 48, borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
      >
        {/* Save / sync status */}
        <div className="flex items-center gap-1.5 flex-shrink-0" style={{ minWidth: 72 }}>
          <AnimatePresence mode="wait">
            {saved ? (
              <motion.div
                key="saved"
                initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                className="flex items-center gap-1"
                style={{ color: 'var(--color-success)', fontSize: 12 }}
              >
                <CheckCircle2 size={12} /> 已儲存
              </motion.div>
            ) : saving ? (
              <motion.div key="saving" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>
                <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" /> 儲存中
              </motion.div>
            ) : (
              <motion.div key="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex items-center gap-1.5" style={{ fontSize: 12, color: connected ? 'var(--color-success)' : 'var(--color-text-quaternary)' }}>
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: connected ? 'var(--color-success)' : 'var(--color-border-strong)' }} />
                {connected ? '已連線' : '離線'}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex-1" />

        {/* Icon toolbar */}
        <ToolbarDivider />

        <ToolbarBtn onClick={() => setPreview(p => !p)} title={preview ? '切換至編輯模式' : '預覽' } active={preview}>
          {preview ? <EyeOff size={15} /> : <Eye size={15} />}
        </ToolbarBtn>

        <ToolbarBtn onClick={() => setShowComments(p => !p)} title="留言討論" active={showComments}>
          <MessageSquare size={15} />
        </ToolbarBtn>

        <ToolbarBtn onClick={() => setShowHistory(true)} title="版本歷史">
          <History size={15} />
        </ToolbarBtn>

        <ToolbarBtn onClick={exportMd} title="匯出 Markdown">
          <Download size={15} />
        </ToolbarBtn>

        <ToolbarBtn onClick={() => handleSave()} title="儲存 ⌘S" disabled={saving}>
          <Save size={15} />
        </ToolbarBtn>

        <ToolbarDivider />

        {/* Share */}
        <button
          onClick={() => setShowShare(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors"
          style={{ fontSize: 12, color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-secondary)'; e.currentTarget.style.borderColor = 'var(--color-border-strong)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-surface)'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
        >
          <Share2 size={13} /> 分享
        </button>

        {/* AI */}
        <button
          onClick={() => onOpenAI?.()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all"
          style={{ fontSize: 12, fontWeight: 500, background: 'linear-gradient(135deg, var(--color-accent), var(--color-ai))', color: 'white', boxShadow: '0 1px 4px rgba(35,131,226,0.25)' }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          <Sparkles size={12} /> AI
        </button>
      </div>

      {/* Document area */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-auto" onMouseUp={handleSelect}>
          <div className="max-w-2xl mx-auto px-10 pt-12 pb-24">
            {/* Emoji + Title */}
            <div className="mb-2">
              <span className="text-4xl select-none" style={{ cursor: 'default' }}>
                {doc.metadata?.source === 'upload' ? '📄' : '📝'}
              </span>
            </div>
            <h1 className="leading-tight mb-3" style={{ fontSize: 36, fontWeight: 700, color: '#1a1a2e', letterSpacing: '-0.8px', lineHeight: 1.15 }}>
              {doc.title}
            </h1>

            {/* Metadata row */}
            <div className="flex items-center gap-4 pb-6 mb-6" style={{ borderBottom: '1px solid var(--color-border)', fontSize: 12, color: 'var(--color-text-quaternary)' }}>
              <span>最後編輯 {doc.updatedAt ? new Date(doc.updatedAt).toLocaleDateString('zh-TW') : '今天'}</span>
              <span style={{ color: 'var(--color-accent)', fontWeight: 500, cursor: 'default' }}>{content.length} 字</span>
            </div>

            {/* Editor / Preview */}
            <AnimatePresence mode="wait">
              {preview ? (
                <motion.div
                  key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
                  className="prose-light min-h-96"
                  dangerouslySetInnerHTML={{ __html: content ? renderMarkdown(content) : '<p style="color:#c8c8ce;font-style:italic">無內容，切換至編輯模式開始撰寫...</p>' }}
                  onClick={e => {
                    const target = e.target as HTMLElement;
                    const link = target.closest('[data-wikilink]') as HTMLElement | null;
                    if (link) {
                      const title = decodeURIComponent(link.dataset.wikilink ?? '');
                      const found = documents.find(d => d.title.toLowerCase() === title.toLowerCase());
                      if (found) onNavigateDoc?.(found.id);
                    }
                  }}
                />
              ) : (
                <motion.textarea
                  key="edit"
                  ref={textareaRef}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
                  className="w-full bg-transparent resize-none outline-none"
                  style={{ fontSize: 15, color: 'var(--color-text-primary)', lineHeight: 1.85, minHeight: 480, caretColor: 'var(--color-accent)' }}
                  placeholder={`開始輸入...\n\n支援 Markdown：# 標題  **粗體**  *斜體*  - 列表  - [ ] 任務  \`code\`\n\n輸入 / 喚醒 Block 選單 · 選取文字呼叫 AI`}
                  onChange={handleTextareaInput}
                  onKeyDown={handleKeyDown}
                  defaultValue={content}
                  onMouseUp={handleSelect}
                />
              )}
            </AnimatePresence>
          {/* Backlinks Panel */}
          {doc && documents.length > 0 && (
            <BacklinksPanel
              currentDoc={{ id: doc.id, title: doc.title ?? '無標題', content }}
              documents={documents}
              onNavigate={id => onNavigateDoc?.(id)}
            />
          )}
          </div>
        </div>

        {/* Comments Panel */}
        <AnimatePresence>
          {showComments && (
            <motion.div
              initial={{ width: 0, opacity: 0 }} animate={{ width: 320, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
              className="border-l border-border bg-surface-secondary flex flex-col flex-shrink-0"
            >
              <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-surface">
                <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                  <MessageSquare size={16} className="text-text-tertiary" /> 留言討論
                </h3>
                <button onClick={() => setShowComments(false)} className="text-text-tertiary hover:text-text-primary">✕</button>
              </div>
              <div className="px-4 py-2 border-b border-border bg-surface-secondary">
                <div className="flex items-center gap-1">
                  {(['open', 'resolved', 'all'] as const).map((statusKey) => (
                    <button
                      key={statusKey}
                      onClick={() => setThreadFilter(statusKey)}
                      className="px-2 py-1 rounded-md text-xs transition-colors"
                      style={{
                        background: threadFilter === statusKey ? 'var(--color-accent-light)' : 'transparent',
                        color: threadFilter === statusKey ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                      }}
                    >
                      {statusKey === 'open' ? 'Open' : statusKey === 'resolved' ? 'Resolved' : 'All'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="bg-surface border border-border rounded-xl p-3 shadow-sm">
                  {threadComposer ? (
                    <>
                      <p className="text-[11px] text-text-tertiary mb-2">錨點文字</p>
                      <p className="text-xs text-text-primary bg-surface-secondary border border-border rounded-lg px-2 py-1.5">
                        {threadComposer.selectedText}
                      </p>
                      <div className="mt-3">
                        <MentionInput
                          value={threadBody}
                          onChange={setThreadBody}
                          onSubmit={handleCreateThread}
                          placeholder="輸入留言內容，支援 @mention"
                          members={workspaceMembers}
                          submitting={threadSubmitting}
                          buttonLabel="建立留言串"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-text-tertiary leading-relaxed">
                      先在文件中選取文字，再點擊「留言」建立錨點討論。
                    </div>
                  )}
                </div>

                {threadsLoading ? (
                  <div className="text-xs text-text-tertiary">載入留言中...</div>
                ) : commentThreads.length === 0 ? (
                  <div className="text-xs text-text-tertiary">目前沒有留言串</div>
                ) : (
                  commentThreads.map((thread) => (
                    <div
                      key={thread.id}
                      className="bg-surface border rounded-xl p-3 shadow-sm"
                      style={{
                        borderColor: selectedThreadId === thread.id ? 'var(--color-accent)' : 'var(--color-border)',
                        background: selectedThreadId === thread.id ? 'var(--color-accent-light)' : 'var(--color-surface)',
                      }}
                    >
                      <button onClick={() => focusThreadAnchor(thread)} className="w-full text-left">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium text-text-primary truncate">
                            {thread.anchor?.selected_text || '未命名留言串'}
                          </p>
                          <div className="flex items-center gap-1">
                            {thread.sync_status === 'queued' && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded-full border"
                                style={{ color: 'var(--color-warning)', borderColor: 'var(--color-warning)' }}
                              >
                                Queued
                              </span>
                            )}
                            {thread.sync_status === 'failed' && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded-full border"
                                style={{ color: 'var(--color-error)', borderColor: 'var(--color-error)' }}
                              >
                                Failed
                              </span>
                            )}
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded-full border"
                              style={{
                                color: thread.status === 'resolved' ? 'var(--color-success)' : 'var(--color-warning)',
                                borderColor: thread.status === 'resolved' ? 'var(--color-success)' : 'var(--color-warning)',
                              }}
                            >
                              {thread.status === 'resolved' ? 'Resolved' : 'Open'}
                            </span>
                          </div>
                        </div>
                        {thread.anchor?.context_before || thread.anchor?.context_after ? (
                          <p className="mt-1 text-[11px] text-text-tertiary">
                            ...{thread.anchor?.context_before || ''}
                            <span className="text-text-secondary font-medium">{thread.anchor?.selected_text || ''}</span>
                            {thread.anchor?.context_after || ''}...
                          </p>
                        ) : null}
                      </button>

                      <div className="mt-2 space-y-2">
                        {thread.comments.map((comment) => (
                          <div key={comment.id} className="bg-surface-secondary border border-border rounded-lg px-2 py-1.5">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-[11px] font-medium text-text-primary">
                                {comment.created_by_name || '成員'}
                              </span>
                              <span className="text-[10px] text-text-tertiary">
                                {new Date(comment.created_at).toLocaleString('zh-TW', { hour: '2-digit', minute: '2-digit', month: '2-digit', day: '2-digit' })}
                              </span>
                            </div>
                            <p className="text-xs text-text-primary whitespace-pre-wrap">{comment.body_markdown}</p>
                            {(comment.mention_count ?? 0) > 0 && (
                              <p className="mt-1 text-[10px] text-accent">提及 {comment.mention_count} 人</p>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="mt-2">
                        <MentionInput
                          value={replyDrafts[thread.id] ?? ''}
                          onChange={(value) => setReplyDrafts((prev) => ({ ...prev, [thread.id]: value }))}
                          onSubmit={() => handleReplyThread(thread.id)}
                          placeholder="回覆留言，支援 @mention"
                          members={workspaceMembers}
                          submitting={replySubmitting[thread.id]}
                          buttonLabel="回覆"
                        />
                      </div>

                      <div className="mt-2 flex justify-end">
                        <button
                          onClick={() => handleToggleThreadStatus(thread)}
                          className="text-[11px] px-2 py-1 rounded-md border border-border text-text-secondary hover:bg-surface-secondary"
                        >
                          {thread.status === 'open' ? 'Resolve' : 'Reopen'}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Hint bar */}
      {!preview && (
        <div
          className="px-10 py-1.5 flex-shrink-0 max-w-2xl mx-auto w-full flex items-center gap-3"
          style={{ borderTop: '1px solid var(--color-border)', fontSize: 11, color: 'var(--color-text-quaternary)' }}
        >
          <span>Markdown</span>
          <span style={{ color: 'var(--color-border-strong)' }}>·</span>
          <span>輸入 <kbd style={{ padding: '1px 5px', border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-surface-secondary)', fontFamily: 'inherit' }}>/</kbd> 選擇 Block</span>
          <span style={{ color: 'var(--color-border-strong)' }}>·</span>
          <span>選取文字呼叫 AI</span>
          <span style={{ color: 'var(--color-border-strong)' }}>·</span>
          <span>⌘S 儲存</span>
        </div>
      )}

      {/* Version History Modal */}
      <AnimatePresence>
        {showHistory && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" onClick={() => setShowHistory(false)}>
            <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }} onClick={e => e.stopPropagation()} className="bg-panel border border-border rounded-2xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-surface-secondary">
                <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2"><History size={16} className="text-text-tertiary" /> 版本歷史紀錄</h3>
                <button onClick={() => setShowHistory(false)} className="text-text-tertiary hover:text-text-primary">✕</button>
              </div>
              <div className="p-5 overflow-y-auto flex-1 space-y-4">
                {[ { time: '剛剛', user: '你', desc: '自動儲存' }, { time: '2 小時前', user: 'AI 助理', desc: '透過 GraphRAG 總結內容' }, { time: '昨天 14:30', user: '你', desc: '建立文件' } ].map((h, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-xl hover:bg-surface-secondary transition-colors border border-transparent hover:border-border group cursor-pointer">
                    <div className="w-8 h-8 rounded-full bg-surface-tertiary flex items-center justify-center text-xs font-medium text-text-secondary flex-shrink-0">{h.user.charAt(0)}</div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-text-primary">{h.user}</span>
                        <span className="text-xs text-text-tertiary">{h.time}</span>
                      </div>
                      <p className="text-xs text-text-secondary">{h.desc}</p>
                    </div>
                    <button className="opacity-0 group-hover:opacity-100 text-xs px-2 py-1 bg-surface border border-border rounded text-text-secondary hover:text-accent transition-all">還原</button>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Share Modal */}
      <ShareModal
        isOpen={showShare}
        onClose={() => setShowShare(false)}
        workspaceId={workspaceId}
        workspaceName="目前工作區"
      />
    </motion.div>
  );
}
