import React, { useState, useRef, useEffect } from 'react';
import { X, MessageSquarePlus, Bug, Lightbulb, HelpCircle, Send, Check, Loader2 } from 'lucide-react';
import { submitFeedback } from '../api/client';

type FeedbackType = 'bug' | 'idea' | 'other';

interface Props {
  open: boolean;
  onClose: () => void;
  workspaceId?: string;
}

const TYPE_OPTIONS: { value: FeedbackType; label: string; icon: React.ReactNode; desc: string }[] = [
  { value: 'bug', label: '回報問題', icon: <Bug size={16} />, desc: '功能異常、顯示錯誤' },
  { value: 'idea', label: '功能建議', icon: <Lightbulb size={16} />, desc: '您希望看到的新功能' },
  { value: 'other', label: '其他', icon: <HelpCircle size={16} />, desc: '一般回饋或問題' },
];

export default function FeedbackModal({ open, onClose, workspaceId }: Props) {
  const [type, setType] = useState<FeedbackType>('bug');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setStatus('idle');
      setErrorMsg('');
      setMessage('');
      setType('bug');
      setTimeout(() => textareaRef.current?.focus(), 80);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canSubmit = message.trim().length > 0 && message.length <= 5000 && status === 'idle';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus('submitting');
    try {
      const ua = navigator.userAgent;
      await submitFeedback(type, message.trim(), workspaceId, { userAgent: ua, url: window.location.href });
      setStatus('success');
    } catch (err: any) {
      setErrorMsg(err?.message ?? '送出失敗，請稍後再試。');
      setStatus('error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9000] flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="回報問題 / 提供回饋"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-md bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <MessageSquarePlus size={18} className="text-violet-500" />
            <h2 className="font-semibold text-neutral-900 dark:text-neutral-100 text-sm">回饋與問題回報</h2>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors rounded-lg p-1"
            aria-label="關閉"
          >
            <X size={16} />
          </button>
        </div>

        {status === 'success' ? (
          /* Success State */
          <div className="flex flex-col items-center justify-center gap-3 px-5 py-10">
            <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
              <Check size={24} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="font-medium text-neutral-900 dark:text-neutral-100 text-sm">感謝您的回饋！</p>
            <p className="text-xs text-neutral-500 text-center">我們已收到您的訊息，將盡快處理。</p>
            <button
              onClick={onClose}
              className="mt-2 px-4 py-2 text-xs font-medium rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 transition-colors"
            >
              關閉
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-5 pb-5 space-y-4">
            {/* Type selector */}
            <div className="grid grid-cols-3 gap-2">
              {TYPE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setType(opt.value)}
                  className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl border text-xs transition-all ${
                    type === opt.value
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300'
                      : 'border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-600'
                  }`}
                >
                  {opt.icon}
                  <span className="font-medium">{opt.label}</span>
                  <span className="text-[10px] text-center leading-tight opacity-70">{opt.desc}</span>
                </button>
              ))}
            </div>

            {/* Textarea */}
            <div>
              <textarea
                ref={textareaRef}
                value={message}
                onChange={e => { setMessage(e.target.value); if (status === 'error') setStatus('idle'); }}
                placeholder={type === 'bug' ? '請描述問題發生的情境與步驟…' : type === 'idea' ? '請描述您希望實現的功能…' : '請輸入您的想法…'}
                rows={5}
                maxLength={5000}
                className="w-full text-sm rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/40 transition-shadow"
              />
              <div className="flex justify-between mt-1 px-0.5">
                {status === 'error' ? (
                  <p className="text-xs text-red-500">{errorMsg}</p>
                ) : (
                  <span />
                )}
                <span className={`text-[11px] ${message.length > 4800 ? 'text-amber-500' : 'text-neutral-400'}`}>
                  {message.length} / 5000
                </span>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium
                         bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900
                         hover:bg-neutral-700 dark:hover:bg-neutral-300 transition-colors
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {status === 'submitting' ? (
                <><Loader2 size={14} className="animate-spin" /> 送出中…</>
              ) : (
                <><Send size={14} /> 送出回饋</>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
