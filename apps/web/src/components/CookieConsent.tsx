import React, { useState, useEffect } from 'react';
import { X, Cookie } from 'lucide-react';

const CONSENT_KEY = 'pegn-cookie-consent';

type ConsentState = 'accepted' | 'declined' | null;

interface CookieConsentProps {
  privacyPolicyUrl?: string;
  onPrivacyClick?: () => void;
}

export default function CookieConsent({ privacyPolicyUrl = '/privacy', onPrivacyClick }: CookieConsentProps) {
  const [consent, setConsent] = useState<ConsentState>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Delay showing banner to avoid layout flash
    const stored = localStorage.getItem(CONSENT_KEY) as ConsentState | null;
    if (!stored) {
      const timer = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(timer);
    }
    setConsent(stored);
  }, []);

  const handleAccept = () => {
    localStorage.setItem(CONSENT_KEY, 'accepted');
    setConsent('accepted');
    setVisible(false);
    // Notify analytics systems that consent was granted
    window.dispatchEvent(new CustomEvent('cookie-consent', { detail: { granted: true } }));
  };

  const handleDecline = () => {
    localStorage.setItem(CONSENT_KEY, 'declined');
    setConsent('declined');
    setVisible(false);
    window.dispatchEvent(new CustomEvent('cookie-consent', { detail: { granted: false } }));
  };

  if (!visible || consent !== null) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie 使用同意"
      aria-live="polite"
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:bottom-6 md:max-w-sm z-50
                 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700
                 rounded-xl shadow-xl p-4 flex flex-col gap-3"
    >
      <div className="flex items-start gap-3">
        <Cookie className="shrink-0 text-amber-500 mt-0.5" size={18} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
            關於 Cookie 與追蹤
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
            我們使用必要的 Cookie 維護登入狀態，以及選擇性分析 Cookie（GA4）改善產品體驗。
            您可以選擇接受或拒絕可選 Cookie。詳情請見{' '}
            <a
              href={onPrivacyClick ? '#' : privacyPolicyUrl}
              target={onPrivacyClick ? undefined : '_blank'}
              rel="noopener noreferrer"
              className="underline text-neutral-700 dark:text-neutral-300 hover:text-neutral-900"
              onClick={onPrivacyClick ? (e) => { e.preventDefault(); onPrivacyClick(); } : undefined}
            >
              隱私政策
            </a>
            。
          </p>
        </div>
        <button
          onClick={handleDecline}
          className="shrink-0 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          aria-label="關閉並拒絕可選 Cookie"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={handleDecline}
          className="text-xs px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700
                     text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800
                     transition-colors"
        >
          僅必要
        </button>
        <button
          onClick={handleAccept}
          className="text-xs px-3 py-1.5 rounded-lg bg-neutral-900 dark:bg-neutral-100
                     text-white dark:text-neutral-900 font-medium hover:bg-neutral-700 dark:hover:bg-neutral-300
                     transition-colors"
        >
          接受全部
        </button>
      </div>
    </div>
  );
}

/** Returns the stored consent state without rendering anything. */
export function getCookieConsent(): ConsentState {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(CONSENT_KEY) as ConsentState;
}
