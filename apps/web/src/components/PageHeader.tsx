import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Image, X, ChevronRight, Smile } from 'lucide-react';

// ── Emoji groups for icon picker ──────────────────────────────────────────
const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  { label: '文件', emojis: ['📝', '📄', '📃', '📊', '📈', '📉', '📑', '📋', '🗒️', '📓', '📔', '📒', '📕', '📗', '📘', '📙'] },
  { label: '靈感', emojis: ['💡', '🔥', '✨', '💫', '⭐', '🌟', '🎯', '🏆', '💎', '🚀', '🌈', '⚡'] },
  { label: '自然', emojis: ['🌿', '🌸', '🌺', '🍀', '🌻', '🌙', '🌍', '🌊', '🍃', '🌾', '🍁', '🌴'] },
  { label: '科技', emojis: ['💻', '🖥️', '📱', '⌨️', '🔧', '⚙️', '🔬', '🧬', '🤖', '💾', '📡', '🔌'] },
  { label: '商業', emojis: ['💼', '📁', '🗂️', '📂', '💰', '🏢', '🤝', '📊', '🎪', '🏛️', '🎓', '🔑'] },
  { label: '生活', emojis: ['🏠', '🎨', '🎵', '🎮', '🍕', '☕', '🏃', '💪', '🧘', '🎭', '🌮', '🍜'] },
];

// ── Cover gradient presets ────────────────────────────────────────────────
const COVER_GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  'linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)',
  'linear-gradient(135deg, #96fbc4 0%, #f9f586 100%)',
];

function coverGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COVER_GRADIENTS[hash % COVER_GRADIENTS.length];
}

// ── Icon Picker Popup ─────────────────────────────────────────────────────
function IconPicker({ onSelect, onClose }: { onSelect: (emoji: string) => void; onClose: () => void }) {
  const [activeGroup, setActiveGroup] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.94, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: 6 }}
      transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
      className="absolute z-50 rounded-xl overflow-hidden"
      style={{
        top: '100%',
        left: 0,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-xl, 0 20px 60px rgba(0,0,0,0.15))',
        width: 300,
        marginTop: 6,
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Group tabs */}
      <div
        className="flex gap-0.5 px-2 pt-2 pb-1"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        {EMOJI_GROUPS.map((g, i) => (
          <button
            key={g.label}
            onClick={() => setActiveGroup(i)}
            className="px-2 py-1 rounded-md text-xs transition-colors"
            style={{
              background: activeGroup === i ? 'var(--color-accent-light)' : 'transparent',
              color: activeGroup === i ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
              fontWeight: activeGroup === i ? 500 : 400,
            }}
          >
            {g.label}
          </button>
        ))}
      </div>
      {/* Emoji grid */}
      <div className="p-2 grid grid-cols-8 gap-0.5">
        {EMOJI_GROUPS[activeGroup].emojis.map(emoji => (
          <button
            key={emoji}
            onClick={() => { onSelect(emoji); onClose(); }}
            className="flex items-center justify-center rounded-lg transition-colors"
            style={{ width: 32, height: 32, fontSize: 18 }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-secondary)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {emoji}
          </button>
        ))}
      </div>
      <div
        className="flex gap-1 px-2 pb-2"
        style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8 }}
      >
        <button
          onClick={() => { onSelect(''); onClose(); }}
          className="text-xs px-3 py-1.5 rounded-lg transition-colors w-full"
          style={{
            background: 'var(--color-surface-secondary)',
            color: 'var(--color-text-tertiary)',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--color-error)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)'; }}
        >
          移除圖示
        </button>
      </div>
    </motion.div>
  );
}

// ── Breadcrumb ────────────────────────────────────────────────────────────
export function Breadcrumb({
  ancestors, current, onNavigate,
}: {
  ancestors: { id: string; title: string; icon?: string }[];
  current: string;
  onNavigate: (id: string) => void;
}) {
  if (ancestors.length === 0) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap" style={{ fontSize: 12, color: 'var(--color-text-quaternary)' }}>
      {ancestors.map((a, i) => (
        <React.Fragment key={a.id}>
          <button
            onClick={() => onNavigate(a.id)}
            className="flex items-center gap-1 hover:underline transition-colors"
            style={{ color: 'var(--color-text-quaternary)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-quaternary)')}
          >
            {a.icon && <span style={{ fontSize: 11 }}>{a.icon}</span>}
            <span className="truncate" style={{ maxWidth: 120 }}>{a.title}</span>
          </button>
          <ChevronRight size={10} style={{ flexShrink: 0 }} />
        </React.Fragment>
      ))}
      <span style={{ color: 'var(--color-text-tertiary)' }}>{current}</span>
    </div>
  );
}

// ── PageHeader ─────────────────────────────────────────────────────────────
interface PageHeaderProps {
  doc: { id: string; title: string; metadata?: any } | null;
  ancestors?: { id: string; title: string; icon?: string }[];
  onChangeIcon?: (icon: string) => void;
  onChangeCover?: (cover: string | null) => void;
  onChangeTitle?: (title: string) => void;
  onNavigate?: (id: string) => void;
}

export default function PageHeader({
  doc,
  ancestors = [],
  onChangeIcon,
  onChangeCover,
  onChangeTitle,
  onNavigate,
}: PageHeaderProps) {
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [showCoverMenu, setShowCoverMenu] = useState(false);
  const [titleVal, setTitleVal] = useState(doc?.title ?? '');
  const titleRef = useRef<HTMLHeadingElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setTitleVal(doc?.title ?? ''); }, [doc?.id, doc?.title]);

  const hasCover = !!(doc?.metadata?.cover);
  const hasIcon = !!(doc?.metadata?.icon);
  const icon = doc?.metadata?.icon ?? '📝';
  const cover = doc?.metadata?.cover ?? coverGradient(doc?.id ?? '');

  const handleTitleBlur = useCallback(() => {
    const val = titleRef.current?.innerText?.trim() ?? '';
    if (val && val !== doc?.title) onChangeTitle?.(val);
  }, [doc?.title, onChangeTitle]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); (titleRef.current as HTMLElement)?.blur(); }
  }, []);

  const handleCoverGradient = (g: string) => {
    onChangeCover?.(g);
    setShowCoverMenu(false);
  };

  if (!doc) return null;

  return (
    <div className="flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
      {/* Cover strip */}
      <div
        className="relative group w-full overflow-hidden"
        style={{ height: hasCover || showCoverMenu ? 160 : 0, transition: 'height 0.22s ease', background: cover }}
      >
        {/* Overlay buttons on hover */}
        <div className="absolute inset-0 flex items-end justify-end gap-2 p-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setShowCoverMenu(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
            style={{ background: 'rgba(0,0,0,0.4)', color: 'white', backdropFilter: 'blur(4px)' }}
          >
            <Image size={12} /> 更換封面
          </button>
          <button
            onClick={() => onChangeCover?.(null)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-colors"
            style={{ background: 'rgba(0,0,0,0.4)', color: 'white', backdropFilter: 'blur(4px)' }}
            title="移除封面"
          >
            <X size={12} />
          </button>
        </div>

        {/* Gradient picker */}
        <AnimatePresence>
          {showCoverMenu && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-12 left-3 flex gap-1.5 p-2 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}
            >
              {COVER_GRADIENTS.map(g => (
                <button
                  key={g}
                  onClick={() => handleCoverGradient(g)}
                  className="rounded-lg transition-transform hover:scale-110"
                  style={{ width: 28, height: 28, background: g, border: cover === g ? '2.5px solid white' : 'none' }}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Content area */}
      <div className="px-12 pt-4 pb-3" style={{ maxWidth: 900 }}>
        {/* Breadcrumb */}
        {ancestors.length > 0 && (
          <div className="mb-2">
            <Breadcrumb
              ancestors={ancestors}
              current={doc.title}
              onNavigate={id => onNavigate?.(id)}
            />
          </div>
        )}

        {/* Icon + Add cover row */}
        <div className="flex items-end gap-3 mb-3 group/header">
          {/* Icon */}
          <div ref={iconRef} className="relative flex-shrink-0">
            <button
              onClick={() => setShowIconPicker(v => !v)}
              className="flex items-center justify-center rounded-xl transition-all hover:scale-105 active:scale-95"
              style={{
                fontSize: hasCover ? 56 : 42,
                lineHeight: 1,
                width: hasCover ? 72 : 52,
                height: hasCover ? 72 : 52,
                marginTop: hasCover ? -36 : 0,
                background: 'transparent',
              }}
              title="更換圖示"
            >
              {icon}
            </button>
            <AnimatePresence>
              {showIconPicker && (
                <IconPicker
                  onSelect={onChangeIcon ?? (() => {})}
                  onClose={() => setShowIconPicker(false)}
                />
              )}
            </AnimatePresence>
          </div>

          {/* Add cover button (only visible on hover when no cover) */}
          {!hasCover && (
            <button
              onClick={() => { onChangeCover?.(coverGradient(doc.id)); }}
              className="opacity-0 group-hover/header:opacity-100 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-all mb-1"
              style={{
                background: 'var(--color-surface-secondary)',
                color: 'var(--color-text-tertiary)',
                border: '1px solid var(--color-border)',
              }}
            >
              <Image size={11} /> 新增封面
            </button>
          )}

          {/* Add icon button (only when no icon and no icon picker) */}
          {!hasIcon && !showIconPicker && (
            <button
              onClick={() => setShowIconPicker(true)}
              className="opacity-0 group-hover/header:opacity-100 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-all mb-1"
              style={{
                background: 'var(--color-surface-secondary)',
                color: 'var(--color-text-tertiary)',
                border: '1px solid var(--color-border)',
              }}
            >
              <Smile size={11} /> 新增圖示
            </button>
          )}
        </div>

        {/* Editable title */}
        <h1
          ref={titleRef}
          contentEditable
          suppressContentEditableWarning
          onBlur={handleTitleBlur}
          onKeyDown={handleTitleKeyDown}
          className="outline-none w-full"
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: 'var(--color-text-primary)',
            letterSpacing: '-0.5px',
            lineHeight: 1.2,
            minHeight: 40,
            wordBreak: 'break-word',
          }}
          data-placeholder="Untitled"
        >
          {doc.title}
        </h1>
      </div>
    </div>
  );
}
