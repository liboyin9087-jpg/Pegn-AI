import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Keyboard } from 'lucide-react';
import { SHORTCUT_DEFS, type ShortcutDef } from '../hooks/useKeyboardShortcuts';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function KeyboardHelpModal({ open, onClose }: Props) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Group shortcuts
  const groups = SHORTCUT_DEFS.reduce<Record<string, ShortcutDef[]>>((acc, s) => {
    (acc[s.group] ??= []).push(s);
    return acc;
  }, {});

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50"
            style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
            onClick={onClose}
          />

          {/* Dialog */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="鍵盤快捷鍵"
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="fixed z-50 left-1/2"
            style={{ transform: 'translateX(-50%)', top: '14vh', width: 520, maxWidth: 'calc(100vw - 32px)' }}
          >
            <div
              className="rounded-2xl overflow-hidden flex flex-col"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                boxShadow: 'var(--shadow-spotlight)',
                maxHeight: '70vh',
              }}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between px-5 py-3 flex-shrink-0"
                style={{ borderBottom: '1px solid var(--color-border)' }}
              >
                <div className="flex items-center gap-2">
                  <Keyboard size={15} style={{ color: 'var(--color-text-tertiary)' }} />
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    鍵盤快捷鍵
                  </span>
                </div>
                <button
                  onClick={onClose}
                  className="flex items-center justify-center w-6 h-6 rounded-md transition-colors"
                  style={{ color: 'var(--color-text-tertiary)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-secondary)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  aria-label="關閉"
                >
                  <X size={13} />
                </button>
              </div>

              {/* Content */}
              <div className="overflow-y-auto flex-1 px-5 py-4" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {Object.entries(groups).map(([group, items]) => (
                  <section key={group}>
                    <p
                      className="mb-2"
                      style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-quaternary)' }}
                    >
                      {group}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {items.map(item => (
                        <div
                          key={item.label}
                          className="flex items-center justify-between px-3 py-1.5 rounded-lg"
                          style={{ background: 'var(--color-surface-secondary)' }}
                        >
                          <span style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                            {item.label}
                          </span>
                          <div className="flex items-center gap-1">
                            {item.keys.map(k => (
                              <kbd
                                key={k}
                                className="px-1.5 py-0.5 rounded"
                                style={{
                                  fontSize: 11,
                                  fontFamily: 'inherit',
                                  color: 'var(--color-text-secondary)',
                                  background: 'var(--color-surface)',
                                  border: '1px solid var(--color-border)',
                                  lineHeight: '16px',
                                }}
                              >
                                {k}
                              </kbd>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              {/* Footer hint */}
              <div
                className="px-5 py-2 flex-shrink-0 text-center"
                style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-muted)' }}
              >
                <span style={{ fontSize: 11, color: 'var(--color-text-quaternary)' }}>
                  按 <kbd style={{ fontSize: 10, padding: '0 4px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 3, fontFamily: 'inherit' }}>?</kbd> 或 <kbd style={{ fontSize: 10, padding: '0 4px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 3, fontFamily: 'inherit' }}>Esc</kbd> 開關此面板
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
