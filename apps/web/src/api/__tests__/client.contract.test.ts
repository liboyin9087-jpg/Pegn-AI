import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCollection,
  requestPhoneOtp,
  search,
  startSupervisorAgent,
  verifyPhoneOtp,
} from '../client';

describe('API workspace_id contract', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('sends workspace_id for search', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), { status: 200 })
    );

    await search('test', 'ws-1');

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.workspace_id).toBe('ws-1');
  });

  it('normalizes createCollection to workspace_id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'c1' }), { status: 200 })
    );

    await createCollection({ workspaceId: 'ws-2', name: 'Roadmap' });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.workspace_id).toBe('ws-2');
  });

  it('sends workspace_id for supervisor agent', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ run_id: 'r1' }), { status: 200 })
    );

    await startSupervisorAgent('hello', 'ws-3', 'auto');

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.workspace_id).toBe('ws-3');
  });

  it('sends phone payload for otp request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ otp_request_id: 'otp-1' }), { status: 202 })
    );

    await requestPhoneOtp('+886912345678');

    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(String(url)).toContain('/auth/phone/request');
    expect(body.phone).toBe('+886912345678');
  });

  it('sends otp_request_id and code for otp verify', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ token: 't1', user: { id: 'u1' } }), { status: 200 })
    );

    await verifyPhoneOtp('otp-123', '123456', '+886912345678');

    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(String(url)).toContain('/auth/phone/verify');
    expect(body).toMatchObject({
      otp_request_id: 'otp-123',
      code: '123456',
      phone: '+886912345678',
    });
  });
});

