import { spawn } from 'node:child_process';
import http from 'node:http';

const port = Number(process.env.API_PORT ?? 4000);
const url = `http://localhost:${port}/health`;
const timeoutMs = Number(process.env.DEV_SMOKE_TIMEOUT_MS ?? 20000);
const pollIntervalMs = 500;

const child = spawn(process.execPath, ['dist/index.js'], {
  stdio: 'inherit',
  env: { ...process.env },
});

let exited = false;

child.on('exit', (code) => {
  exited = true;
  process.exit(code ?? 1);
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

  req.on('error', () => {
    setTimeout(checkHealth, pollIntervalMs);
  });
}

checkHealth();
