import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number; // ms; 0 = sticky
}

interface ToastContextValue {
  toast: (opts: Omit<Toast, 'id'>) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={16} />,
  error:   <XCircle size={16} />,
  warning: <AlertTriangle size={16} />,
  info:    <Info size={16} />,
};

const ACCENT: Record<ToastType, string> = {
  success: '#0a7a4c',
  error:   '#c93b37',
  warning: '#b87309',
  info:    '#2383e2',
};

const DURATIONS: Record<ToastType, number> = {
  success: 2500,
  error:   0,      // sticky until dismissed
  warning: 4000,
  info:    3000,
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const dur = toast.duration ?? DURATIONS[toast.type];
    if (dur <= 0) return;
    const t = setTimeout(() => onDismiss(toast.id), dur);
    return () => clearTimeout(t);
  }, [toast.id, toast.type, toast.duration, onDismiss]);

  const accent = ACCENT[toast.type];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        minWidth: 280,
        maxWidth: 380,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderLeft: `3px solid ${accent}`,
        borderRadius: 8,
        padding: '10px 12px',
        boxShadow: 'var(--shadow-lg)',
        pointerEvents: 'all',
      }}>
      <span style={{ color: accent, marginTop: 1, flexShrink: 0 }}>
        {ICONS[toast.type]}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', lineHeight: 1.4 }}>
          {toast.title}
        </p>
        {toast.message && (
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
            {toast.message}
          </p>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        style={{
          flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--color-text-tertiary)', padding: 2, borderRadius: 4,
          display: 'flex', alignItems: 'center', marginTop: -1,
        }}>
        <X size={13} />
      </button>
    </motion.div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(ts => ts.filter(t => t.id !== id));
  }, []);

  const push = useCallback((opts: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(ts => {
      const next = [...ts, { ...opts, id }];
      return next.slice(-5); // max 5 toasts
    });
  }, []);

  const ctx: ToastContextValue = {
    toast: push,
    success: (title, message) => push({ type: 'success', title, message }),
    error:   (title, message) => push({ type: 'error',   title, message }),
    warning: (title, message) => push({ type: 'warning', title, message }),
    info:    (title, message) => push({ type: 'info',    title, message }),
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {/* Toast stack — bottom-right */}
      <div style={{
        position: 'fixed', bottom: 24, right: 24,
        display: 'flex', flexDirection: 'column', gap: 8,
        zIndex: 9999, pointerEvents: 'none',
        alignItems: 'flex-end',
      }}>
        <AnimatePresence mode="popLayout">
          {toasts.map(t => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
