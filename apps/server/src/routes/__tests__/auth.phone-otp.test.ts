import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPool = {
  query: vi.fn(),
};

vi.mock('../../db/client.js', () => ({
  pool: mockPool,
}));

import { registerAuthRoutes } from '../auth.js';

describe('auth phone otp routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_OTP_STUB_CODE = '123456';
  });

  it('creates otp request with request metadata', async () => {
    const app = express();
    app.use(express.json());
    registerAuthRoutes(app);

    const res = await request(app)
      .post('/api/v1/auth/phone/request')
      .set('x-request-id', 'req-mobile-1')
      .send({ phone: '+886912345678' });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      request_id: 'req-mobile-1',
      channel: 'sms',
      expires_in: 300,
      retry_after: 30,
      stub: true,
      debug_code: '123456',
    });
    expect(typeof res.body.otp_request_id).toBe('string');
  });

  it('rejects invalid otp code with attempts remaining', async () => {
    const app = express();
    app.use(express.json());
    registerAuthRoutes(app);

    const requestRes = await request(app)
      .post('/api/v1/auth/phone/request')
      .send({ phone: '+886912345678' });

    const verifyRes = await request(app)
      .post('/api/v1/auth/phone/verify')
      .set('x-request-id', 'req-mobile-2')
      .send({
        otp_request_id: requestRes.body.otp_request_id,
        code: '000000',
      });

    expect(verifyRes.status).toBe(401);
    expect(verifyRes.body).toMatchObject({
      request_id: 'req-mobile-2',
      error_code: 'OTP_INVALID_CODE',
    });
    expect(verifyRes.body.attempts_remaining).toBe(4);
  });

  it('verifies otp and issues token using existing user', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-phone-1', email: 'phone_886912345678@phone.pegn.local', name: 'Phone 5678' }], rowCount: 1 });

    const app = express();
    app.use(express.json());
    registerAuthRoutes(app);

    const requestRes = await request(app)
      .post('/api/v1/auth/phone/request')
      .set('x-request-id', 'req-mobile-3')
      .send({ phone: '+886912345678' });

    const verifyRes = await request(app)
      .post('/api/v1/auth/phone/verify')
      .set('x-request-id', 'req-mobile-4')
      .send({
        otp_request_id: requestRes.body.otp_request_id,
        code: '123456',
      });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body).toMatchObject({
      request_id: 'req-mobile-4',
      auth_method: 'phone_otp',
      user: {
        id: 'user-phone-1',
        email: 'phone_886912345678@phone.pegn.local',
        name: 'Phone 5678',
      },
    });
    expect(typeof verifyRes.body.token).toBe('string');
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });
});
