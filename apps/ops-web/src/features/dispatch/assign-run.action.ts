// apps/ops-web/src/features/dispatch/assign-run.action.ts
'use server';
// Server Action per PDF Day-One #7 "Server Action: assign/reassign run".
// Posts to API POST /commands; API writes 3 append paths + Socket.IO push to driver.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

const AssignRunInputSchema = z.object({
  roadRunId: z.guid(),
  operatorId: z.guid(),
  assetId: z.string().min(1).max(64).optional(),
});

export type AssignRunInput = z.infer<typeof AssignRunInputSchema>;

export interface AssignRunIssue {
  readonly code: 'invalid_uuid' | 'too_short' | 'too_long' | 'unknown';
  readonly path: readonly string[];
  readonly message: string;
}

export type AssignRunResult =
  | { readonly status: 'ok'; readonly roadRunId: string; readonly commandId: string }
  | { readonly status: 'invalid_input'; readonly issues: readonly AssignRunIssue[] }
  | { readonly status: 'api_error'; readonly httpStatus: number; readonly message: string }
  | { readonly status: 'config_missing'; readonly message: string };

function mapZodIssue(issue: z.core.$ZodIssue): AssignRunIssue {
  const path = issue.path.map((p) => String(p));
  if (issue.code === 'invalid_format')
    return { code: 'invalid_uuid', path, message: issue.message };
  if (issue.code === 'too_small') return { code: 'too_short', path, message: issue.message };
  if (issue.code === 'too_big') return { code: 'too_long', path, message: issue.message };
  return { code: 'unknown', path, message: issue.message };
}

export async function assignRun(input: unknown): Promise<AssignRunResult> {
  const parsed = AssignRunInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'invalid_input',
      issues: parsed.error.issues.map(mapZodIssue),
    };
  }

  const apiUrl = process.env['FLEET_API_URL'];
  const authToken = process.env['FLEET_API_TOKEN'];
  if (!apiUrl || !authToken) {
    // Pilot/dev fallback: log + revalidate so the UI still moves.
    if (process.env.NODE_ENV !== 'production') {
      revalidatePath('/');
      return { status: 'ok', roadRunId: parsed.data.roadRunId, commandId: 'dev-noop' };
    }
    return { status: 'config_missing', message: 'FLEET_API_URL and FLEET_API_TOKEN must be set' };
  }

  const commandId = randomUUID();
  const body = {
    commandId,
    type: 'assign_run' as const,
    targetOperatorId: parsed.data.operatorId,
    aggregateType: 'road_run',
    aggregateId: parsed.data.roadRunId,
    payload: parsed.data.assetId ? { assetId: parsed.data.assetId } : {},
    issuedAt: new Date().toISOString(),
  };

  const res = await fetch(`${apiUrl}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return { status: 'api_error', httpStatus: res.status, message: res.statusText };
  }
  revalidatePath('/');
  return { status: 'ok', roadRunId: parsed.data.roadRunId, commandId };
}
