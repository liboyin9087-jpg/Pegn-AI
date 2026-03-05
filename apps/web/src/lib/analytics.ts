/**
 * analytics.ts — P0 Growth: GA4 DataLayer 事件追蹤
 *
 * 使用方式：
 *   import { track } from '../lib/analytics';
 *   track('open_modal', { modal: 'new_document' });
 *
 * 所有事件只在使用者已授予 Cookie 同意時才推送。
 * 在 index.html 中加入 GA4 gtag.js 腳本，並設定 VITE_GA4_MEASUREMENT_ID。
 */

type EventParams = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    dataLayer: any[];
    gtag: (...args: any[]) => void;
  }
}

function hasAnalyticsConsent(): boolean {
  return localStorage.getItem('pegn-cookie-consent') === 'accepted';
}

function pushDataLayer(event: string, params?: EventParams): void {
  if (!hasAnalyticsConsent()) return;
  if (typeof window === 'undefined') return;

  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ event, ...params });

  // Also call gtag if it's available (GA4 standard)
  if (typeof window.gtag === 'function') {
    window.gtag('event', event, params);
  }
}

// ──────────────────────────────────────────────────────────
// Typed event catalogue (North Star Funnel + Key Actions)
// ──────────────────────────────────────────────────────────

/** User opened/closed a modal */
export const trackOpenModal = (modal: string) =>
  pushDataLayer('open_modal', { modal });

/** User saved/created a task (collection item) */
export const trackSaveTask = (collectionId: string) =>
  pushDataLayer('save_task', { collection_id: collectionId });

/** User entered Presentation / Zen mode */
export const trackEnterPresentMode = (documentId: string) =>
  pushDataLayer('enter_present_mode', { document_id: documentId });

/** User ran a global search */
export const trackGlobalSearch = (query_length: number) =>
  pushDataLayer('global_search', { query_length });

/** User clicked a search result */
export const trackSearchResultClick = (rank: number, type: 'document' | 'collection' | 'kg') =>
  pushDataLayer('search_result_click', { rank, result_type: type });

/** User triggered an Agent run */
export const trackAgentRun = (template: string, mode: string) =>
  pushDataLayer('agent_run_start', { template, mode });

/** Agent run completed (success/error) */
export const trackAgentRunComplete = (template: string, status: 'done' | 'error', durationMs: number) =>
  pushDataLayer('agent_run_complete', { template, status, duration_ms: durationMs });

/** User generated an AI infographic via NoteLLM */
export const trackNoteLLMGenerate = (type: string) =>
  pushDataLayer('notellm_generate', { output_type: type });

/** User invited a team member */
export const trackMemberInvited = () =>
  pushDataLayer('member_invited');

/** User viewed the billing/upgrade page */
export const trackViewBilling = (trigger: 'quota_exceeded' | 'settings' | 'cta') =>
  pushDataLayer('view_billing', { trigger });

/** User started a Stripe checkout */
export const trackCheckoutStarted = (plan: string) =>
  pushDataLayer('checkout_started', { plan });

/** User completed onboarding */
export const trackOnboardingComplete = () =>
  pushDataLayer('onboarding_complete');

/** User completed the North Star loop: task → knowledge → presentation */
export const trackNorthStarLoop = () =>
  pushDataLayer('north_star_loop_complete');

// ── Generic low-level track function (for ad-hoc events) ──
export function track(event: string, params?: EventParams): void {
  pushDataLayer(event, params);
}

// ── Listen for consent changes and initialize GA4 after consent ────────────
if (typeof window !== 'undefined') {
  window.addEventListener('cookie-consent', (e: Event) => {
    const granted = (e as CustomEvent<{ granted: boolean }>).detail.granted;
    if (granted) {
      const measurementId = import.meta.env.VITE_GA4_MEASUREMENT_ID as string | undefined;
      if (measurementId && typeof window.gtag === 'function') {
        window.gtag('consent', 'update', {
          analytics_storage: 'granted',
        });
        window.gtag('config', measurementId);
      }
    }
  });
}
