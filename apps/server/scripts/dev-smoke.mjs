import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';

const defaultPort = Number(process.env.API_PORT ?? 4000);
const host = process.env.DEV_SMOKE_HOST ?? '127.0.0.1';
const timeoutMs = Number(process.env.DEV_SMOKE_TIMEOUT_MS ?? 20000);
const pollIntervalMs = 500;

function requestHealth(port) {
  const url = `http://${host}:${port}/health`;
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
  });
}

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port);
        } else {
          reject(new Error('Failed to allocate free port'));
        }
      });
    });
  });
}

async function run() {
  const alreadyHealthy = await requestHealth(defaultPort);
  if (alreadyHealthy) {
    console.log('[dev-smoke] /health OK (existing server)');
    process.exit(0);
  }

  const targetPort = await pickFreePort();
  const url = `http://${host}:${targetPort}/health`;

  const child = spawn(process.execPath, ['dist/index.js'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      API_PORT: String(targetPort),
      ENABLE_SYNC_SERVER: 'false',
    },
  });

  let exited = false;

  child.on('exit', async (code) => {
    exited = true;
    const stillHealthy = await requestHealth(defaultPort);
    if (stillHealthy) {
      console.log('[dev-smoke] /health OK (server already running)');
      process.exit(0);
    }
    process.exit(code ?? 1);
  });

  child.on('error', (error) => {
    console.error('[dev-smoke] failed to spawn server', error);
    exited = true;
    process.exit(1);
  });

  function cleanup(exitCode) {
    if (!exited) {
      child.kill();
      setTimeout(() => {
        child.kill('SIGKILL');
      }, 5000).unref();
    }
    process.exit(exitCode);
  }

  const deadline = Date.now() + timeoutMs;

  function checkHealth() {
    if (Date.now() > deadline) {
      console.error(`[dev-smoke] /health did not become ready within ${timeoutMs}ms`);
      cleanup(1);
      return;
    }

    const req = http.get(url, (res) => {
      if (res.statusCode === 200) {
        console.log('[dev-smoke] /health OK');
        cleanup(0);
        return;
      }
      setTimeout(checkHealth, pollIntervalMs);
    });

    req.on('error', (err) => {
      if (process.env.DEV_SMOKE_DEBUG === 'true') {
        console.error('[dev-smoke] health check error', err.message);
      }
      setTimeout(checkHealth, pollIntervalMs);
    });
  }

  checkHealth();
}

run().catch((error) => {
  console.error('[dev-smoke] unexpected error', error);
  process.exit(1);
});
