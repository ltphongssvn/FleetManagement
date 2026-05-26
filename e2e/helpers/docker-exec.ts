// e2e/helpers/docker-exec.ts
// Shared helper for docker exec from Playwright specs with retry-on-transient
// failure. WSL2 + Docker Desktop occasionally returns
// 'WSL ... UtilAcceptVsock:250: accept4 failed 110' when the vsock backlog
// briefly fills under parallel-worker load. These are NOT application bugs;
// retrying within ~2s is the industry-standard mitigation per 2026 Playwright
// + WSL guidance.
//
// Public API:
//   dockerPsql(sql)          -> { stdout, stderr, failed }  retries up to 4 times
//   dockerExecNode(container, script) -> string (stdout)    retries up to 4 times
//
// All retries are bounded; if the final attempt still fails the original
// error surfaces unchanged so genuine bugs are not masked.
import { execSync } from 'node:child_process';

const POSTGRES_CONTAINER = process.env['E2E_PG_CONTAINER'] ?? 'fleet-pilot-postgres-1';
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 150;

export interface PsqlResult { stdout: string; stderr: string; failed: boolean }

function isTransientWslError(stderr: string): boolean {
  // Symptoms observed on WSL2 + Docker Desktop under parallel load:
  //   <3>WSL (PID) ERROR: UtilAcceptVsock:250: accept4 failed 110
  //   error during connect: ... read /var/run/docker.sock: connection reset by peer
  //   client: Error response from daemon: dial unix /var/run/docker.sock: connect: resource temporarily unavailable
  if (stderr.length === 0) return false;
  if (stderr.includes('UtilAcceptVsock')) return true;
  if (stderr.includes('accept4 failed 110')) return true;
  if (stderr.includes('connection reset by peer')) return true;
  if (stderr.includes('resource temporarily unavailable')) return true;
  if (stderr.includes('Error response from daemon') && stderr.includes('dial unix')) return true;
  return false;
}

function sleepSync(ms: number): void {
  // Synchronous sleep is required here because the existing helper API is
  // synchronous (execSync). Cost is bounded by MAX_ATTEMPTS * max backoff.
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy-wait, intentional */ }
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
        sleepSync(BASE_BACKOFF_MS * Math.pow(2, attempt - 1));
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
        sleepSync(BASE_BACKOFF_MS * Math.pow(2, attempt - 1));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr ?? new Error('docker exec failed');
}
