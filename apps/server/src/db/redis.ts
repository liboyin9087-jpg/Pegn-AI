import { Redis } from 'ioredis';

let redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (redis) return redis;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  redis = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    tls: url.startsWith('rediss://') ? {} : undefined,
  });

  redis.on('connect', () => console.log('[redis] connected'));
  redis.on('error', (err: Error) => console.error('[redis] error:', err.message));

  return redis;
}
