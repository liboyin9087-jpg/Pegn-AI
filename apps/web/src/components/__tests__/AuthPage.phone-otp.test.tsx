import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuthPage from '../AuthPage';

const apiMocks = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  setToken: vi.fn(),
  oauthLogin: vi.fn(),
  getOAuthStatus: vi.fn(),
  requestPhoneOtp: vi.fn(),
  verifyPhoneOtp: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  ...apiMocks,
}));

describe('AuthPage phone OTP flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getOAuthStatus.mockResolvedValue({ google: false, github: false });
  });

  it('completes phone otp login and calls onAuth', async () => {
    const onAuth = vi.fn();
    apiMocks.requestPhoneOtp.mockResolvedValue({
      request_id: 'req-1',
      otp_request_id: 'otp-1',
      channel: 'sms',
      expires_in: 300,
      retry_after: 30,
      stub: true,
      debug_code: '123456',
    });
    apiMocks.verifyPhoneOtp.mockResolvedValue({
      request_id: 'req-2',
      auth_method: 'phone_otp',
      token: 'token-otp',
      user: { id: 'u1', email: 'phone_886912345678@phone.pegn.local', name: 'Phone 5678' },
    });

    render(<AuthPage onAuth={onAuth} />);

    fireEvent.click(await screen.findByRole('button', { name: '改用手機驗證碼登入' }));

    const phoneInput = screen.getByLabelText('Phone number');
    fireEvent.change(phoneInput, { target: { value: '+886912345678' } });
    fireEvent.click(screen.getByRole('button', { name: '發送驗證碼' }));

    await waitFor(() => {
      expect(apiMocks.requestPhoneOtp).toHaveBeenCalledWith('+886912345678');
    });

    const otpInput = await screen.findByLabelText('OTP code');
    fireEvent.change(otpInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: '驗證並登入' }));

    await waitFor(() => {
      expect(apiMocks.verifyPhoneOtp).toHaveBeenCalledWith('otp-1', '123456', '+886912345678');
    });
    await waitFor(() => {
      expect(apiMocks.setToken).toHaveBeenCalledWith('token-otp');
      expect(onAuth).toHaveBeenCalledWith({ id: 'u1', email: 'phone_886912345678@phone.pegn.local', name: 'Phone 5678' });
    });
  });

  it('falls back to email login view when phone otp endpoint is unavailable', async () => {
    const onAuth = vi.fn();
    apiMocks.requestPhoneOtp.mockRejectedValue(new Error('API /auth/phone/request failed: 404'));

    render(<AuthPage onAuth={onAuth} />);

    fireEvent.click(await screen.findByRole('button', { name: '改用手機驗證碼登入' }));
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '+886912345678' } });
    fireEvent.click(screen.getByRole('button', { name: '發送驗證碼' }));

    await waitFor(() => {
      expect(screen.getByText('手機驗證暫不可用，請改用 Email 登入')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(onAuth).not.toHaveBeenCalled();
  });
});
