// apps/api/src/push/push-provider.interface.ts
// IPushProvider portability seam per Frozen Stack PDF.
// Operator-aware API: caller passes operatorId; provider resolves device tokens.
export interface PushBody {
  readonly title: string;
  readonly body: string;
  readonly data?: Record<string, unknown>;
}

export interface PushSendResult {
  readonly accepted: number;
  readonly rejected: number;
}

export interface IPushProvider {
  /** Resolve operator's device tokens and send push. Returns counts. */
  sendToOperator(operatorId: string, body: PushBody): Promise<PushSendResult>;
}

export const PUSH_PROVIDER = 'PUSH_PROVIDER' as const;
