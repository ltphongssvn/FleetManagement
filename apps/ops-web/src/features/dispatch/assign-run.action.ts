// apps/ops-web/src/features/dispatch/assign-run.action.ts
'use server';
// Server Action per PDF "Server Action: assign/reassign run".
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const AssignRunInputSchema = z.object({
  roadRunId: z.string().uuid(),
  operatorId: z.string().uuid(),
  assetId: z.string().min(1).max(64).optional(),
});

export type AssignRunInput = z.infer<typeof AssignRunInputSchema>;

export interface AssignRunIssue {
  readonly code: 'invalid_uuid' | 'invalid_string' | 'too_short' | 'too_long' | 'unknown';
  readonly path: readonly string[];
  readonly message: string;
}

export type AssignRunResult =
  | { readonly status: 'ok'; readonly roadRunId: string }
  | { readonly status: 'invalid_input'; readonly issues: readonly AssignRunIssue[] };

function mapZodIssue(issue: { code: string; path: readonly (string | number)[]; message: string }): AssignRunIssue {
  const path = issue.path.map((p) => String(p));
  if (issue.code === 'invalid_string') return { code: 'invalid_uuid', path, message: issue.message };
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
  // Pilot: log and return ok. Real implementation posts to API command flow
  // which writes outbox + sync_change_feed + emits Socket.IO command (week 6+).
  revalidatePath('/');
  return Promise.resolve({ status: 'ok', roadRunId: parsed.data.roadRunId });
}
