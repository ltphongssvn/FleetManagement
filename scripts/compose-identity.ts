// scripts/compose-identity.ts
// Per-worktree Docker Compose identity (docker-isolation arc, 2026-07-06).
// Root cause fixed: compose.yaml hardcoded name fleet-pilot, so EVERY
// worktree operated on the SAME host-wide stack (containers, networks,
// volumes, ports, env). Proven incident: FM-error-presentation recreated
// fleet-pilot-mock-oauth2-1 at 18:20 and silently reverted WT2's
// JSON_CONFIG parity fix. Per 2026 practice (COMPOSE_PROJECT_NAME per
// worktree + deterministic port blocks; worktree-compose pattern), each
// worktree derives its own namespace from its root path and injects it
// idempotently into its own .env, which docker compose reads natively.
// Same key algorithm as apps/api/test/helpers/worktree-container-identity.ts
// so ALL isolation layers (testcontainers + compose) share one identity.
// CLI:
//   tsx scripts/compose-identity.ts --print [--root PATH]
//   tsx scripts/compose-identity.ts --env FILE [--root PATH]
// Wired as root scripts: compose:env (inject into ./.env), compose:print.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { z } from 'zod';

export const PORT_NAMES = Object.freeze([
  'API', 'OPS_WEB', 'OAUTH', 'POSTGRES', 'REDIS', 'S3',
  'EXPO_METRO', 'EXPO_DEV', 'EXPO_DEV2',
] as const);
export type PortName = (typeof PORT_NAMES)[number];
export type PortMap = Readonly<Record<PortName, number>>;

export interface ComposeIdentity {
  readonly key: string;
  readonly project: string;
  readonly ports: PortMap;
}

const BLOCK_BEGIN = '# >>> fleet-compose-identity (managed; do not edit) >>>';
const BLOCK_END = '# <<< fleet-compose-identity <<<';
const NL = String.fromCharCode(10);

/** Stable 12-hex key for a worktree root (same algorithm as testcontainers layer). */
export function worktreeKey(rootPath: string): string {
  const normalized = rootPath.replace(/[/]+$/, '');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

export function composeProject(key: string): string {
  return 'fleet-' + key;
}

/** Deterministic block of 20 ports from 20000; 9 named consecutive offsets. */
export function portBlock(key: string): PortMap {
  const base = 20000 + (parseInt(key.slice(0, 4), 16) % 480) * 20;
  const entries = PORT_NAMES.map((name, i) => [name, base + i] as const);
  return Object.freeze(Object.fromEntries(entries)) as PortMap;
}

export function identityFor(rootPath: string): ComposeIdentity {
  const key = worktreeKey(rootPath);
  return { key, project: composeProject(key), ports: portBlock(key) };
}

function renderBlock(id: ComposeIdentity): string {
  const lines = [
    BLOCK_BEGIN,
    'FLEET_WORKTREE_KEY=' + id.key,
    'FLEET_COMPOSE_PROJECT=' + id.project,
  ];
  for (const name of PORT_NAMES) {
    lines.push('FLEET_PORT_' + name + '=' + String(id.ports[name]));
  }
  lines.push(BLOCK_END);
  return lines.join(NL);
}

/** Pure, idempotent: one managed block; unrelated lines preserved. */
export function injectEnv(content: string, id: ComposeIdentity): string {
  const block = renderBlock(id);
  const begin = content.indexOf(BLOCK_BEGIN);
  const end = content.indexOf(BLOCK_END);
  if (begin >= 0 && end > begin) {
    const before = content.slice(0, begin);
    const after = content.slice(end + BLOCK_END.length);
    return before + block + after;
  }
  const sep = content.length === 0 || content.endsWith(NL) ? '' : NL;
  return content + sep + block + NL;
}

const ArgsSchema = z.object({
  root: z.string().min(1),
  print: z.boolean(),
  env: z.string().min(1).optional(),
});

function parseArgs(argv: readonly string[]): z.infer<typeof ArgsSchema> {
  const out: Record<string, unknown> = { root: process.cwd(), print: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--print') out['print'] = true;
    else if (a === '--root') { out['root'] = argv[i + 1]; i += 1; }
    else if (a === '--env') { out['env'] = argv[i + 1]; i += 1; }
  }
  return ArgsSchema.parse(out);
}

/* v8 ignore start -- CLI shell: exercised via compose:env, logic above is unit-tested */
const isMain = process.argv[1]?.endsWith('compose-identity.ts') ?? false;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const id = identityFor(args.root);
  if (args.env !== undefined) {
    const existing = existsSync(args.env) ? readFileSync(args.env, 'utf-8') : '';
    writeFileSync(args.env, injectEnv(existing, id));
    process.stderr.write('compose-identity: injected ' + id.project + ' into ' + args.env + NL);
  }
  if (args.print || args.env === undefined) {
    process.stdout.write(JSON.stringify(id, null, 2) + NL);
  }
}
/* v8 ignore stop */
