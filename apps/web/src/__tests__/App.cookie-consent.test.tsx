/**
 * App.cookie-consent.test.tsx
 * E2E tests for cookie consent banner behaviour.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CookieConsent from '../components/CookieConsent';

const CONSENT_KEY = 'pegn-cookie-consent';

describe('CookieConsent', () => {
  beforeEach(() => {
    localStorage.removeItem(CONSENT_KEY);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not render immediately (debounced 800ms)', () => {
    render(<CookieConsent />);
    // Before 800ms: banner not visible
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('appears after 800ms when no consent stored', async () => {
    render(<CookieConsent />);
    await act(async () => { vi.advanceTimersByTime(900); });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('hides after accepting', async () => {
    render(<CookieConsent />);
    await act(async () => { vi.advanceTimersByTime(900); });
    fireEvent.click(screen.getByText(/接受全部/i));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem(CONSENT_KEY)).toBe('accepted');
  });

  it('hides after declining', async () => {
    render(<CookieConsent />);
    await act(async () => { vi.advanceTimersByTime(900); });
    // Click the first "僅必要" button
    fireEvent.click(screen.getAllByText(/僅必要/i)[0]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem(CONSENT_KEY)).toBe('declined');
  });

  it('does not show when consent already stored', async () => {
    localStorage.setItem(CONSENT_KEY, 'accepted');
    render(<CookieConsent />);
    await act(async () => { vi.advanceTimersByTime(900); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('fires cookie-consent event with granted=true when accepted', async () => {
    const handler = vi.fn();
    window.addEventListener('cookie-consent', handler);
    render(<CookieConsent />);
    await act(async () => { vi.advanceTimersByTime(900); });
    fireEvent.click(screen.getByText(/接受全部/i));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ detail: { granted: true } }));
    window.removeEventListener('cookie-consent', handler);
  });

  it('calls onPrivacyClick when privacy link clicked', async () => {
    const onPrivacyClick = vi.fn();
    render(<CookieConsent onPrivacyClick={onPrivacyClick} />);
    await act(async () => { vi.advanceTimersByTime(900); });
    fireEvent.click(screen.getByText(/隱私政策/i));
    expect(onPrivacyClick).toHaveBeenCalled();
  });
});
