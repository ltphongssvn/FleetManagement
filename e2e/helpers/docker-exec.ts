// e2e/helpers/docker-exec.ts
// Shared helper for docker exec from Playwright specs with retry-on-transient
// failure. WSL2 + Docker Desktop occasionally returns
// 'WSL ... UtilAcceptVsock:250: accept4 failed 110' when the vsock backlog
// briefly fills under parallel-worker load. These are NOT application bugs;
// retrying with exponential backoff is the industry-standard mitigation per
// 2026 Playwright + WSL guidance.
//
// 2026-Q2 hardening: bumped MAX_ATTEMPTS to 6 and capped backoff at 1600ms
// (total ~7.5s budget). WSL VSock flaps during a fresh `compose up --build`
// can last several seconds; 4 attempts at 150–1200ms were insufficient.
import { execSync } from 'node:child_process';
const POSTGRES_CONTAINER = process.env['E2E_PG_CONTAINER'] ?? 'fleet-pilot-postgres-1';
const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 200;
const MAX_BACKOFF_MS = 3200;
export interface PsqlResult { stdout: string; stderr: string; failed: boolean }
function isTransientWslError(stderr: string): boolean {
  if (stderr.length === 0) return false;
  if (stderr.includes('UtilAcceptVsock')) return true;
  if (stderr.includes('accept4 failed 110')) return true;
  if (stderr.includes('connection reset by peer')) return true;
  if (stderr.includes('resource temporarily unavailable')) return true;
  if (stderr.includes('Error response from daemon') && stderr.includes('dial unix')) return true;
  if (stderr.includes('container ') && stderr.includes('not running')) return true;
  if (stderr.includes('No such container')) return true;
  if (stderr.includes('EPIPE')) return true;
  return false;
}
function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy-wait, intentional */ }
}
function backoffMs(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, attempt - 1));
}
export function dockerPsql(sql: string): PsqlResult {
  const cmd = 'docker exec -i ' + POSTGRES_CONTAINER + ' psql -U fleet -d fleet -tA -v ON_ERROR_STOP=1';
  let last: PsqlResult = { stdout: '', stderr: '', failed: true };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const stdout = execSync(cmd, { input: sql, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
      return { stdout, stderr: '', failed: false };
    } catch (e) {
      const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string };
      const stderr = (err.stderr ? err.stderr.toString() : '') + (err.message ?? '');
      last = { stdout: err.stdout ? err.stdout.toString() : '', stderr, failed: true };
      if (attempt < MAX_ATTEMPTS && isTransientWslError(stderr)) {
        sleepSync(backoffMs(attempt));
        continue;
      }
      return last;
    }
  }
  return last;
}
export function dockerExecNode(container: string, script: string): string {
  const cmd = 'docker exec ' + container + ' node -e ' + JSON.stringify(script);
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'] }).toString();
    } catch (e) {
      const err = e as { stderr?: Buffer; message?: string };
      const stderr = (err.stderr ? err.stderr.toString() : '') + (err.message ?? '');
      lastErr = new Error(stderr);
      if (attempt < MAX_ATTEMPTS && isTransientWslError(stderr)) {
        sleepSync(backoffMs(attempt));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr ?? new Error('docker exec failed');
}
