// apps/api/src/device/attestation.controller.ts
// HTTP layer for device attestation. JWT-gated (driver already authenticated).
// Two endpoints:
//   POST /device/attest/nonce  -> server issues short-lived nonce bound to operator
//   POST /device/attest/verify -> client sends platform token; server verifies + persists
// Nonce store is operator-scoped (replay defense across devices for the same driver).
// Token hash (SHA-256 hex) is persisted for audit, not the raw token.
import { Body, Controller, ForbiddenException, Inject, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { AttestationService } from './attestation.service.js';
// Platform enum SSOT (P1-#6): attestation accepts the mobile-only subset of the
// shared PlatformSchema (no web attestation token), derived via .exclude(['web']).
import { AttestationPlatformSchema, type AttestationPlatform } from './platform.js';
import type { OperatorContext } from '@fleet/domain';

export const ATTESTATION_NONCE_STORE = Symbol.for('AttestationNonceStore');
export const ATTESTATION_REPO = Symbol.for('AttestationRepository');

export interface AttestationNonceStore {
  issue(operatorId: string): Promise<string>;
  consume(operatorId: string): Promise<string | null>;
}
export interface AttestationRepository {
  markAttestationVerified(input: { deviceId: string; platform: AttestationPlatform; tokenHashHex: string; publicKeySpkiBase64: string; securityLevel: string | null; environment: string; keyId: string | null }): Promise<void>;
}

// iOS App Attest additionally carries the client-generated keyId (SHA-256 of
// the Secure Enclave public key); Android Key Attestation has no keyId, so it
// is optional and dispatched only for the iOS path.
const VerifyBodySchema = z.object({
  platform: AttestationPlatformSchema,
  token: z.string().min(1),
  deviceId: z.guid(),
  keyId: z.string().min(1).optional(),
});
type VerifyBody = z.infer<typeof VerifyBodySchema>;

@Controller('device/attest')
export class AttestationController {
  constructor(
    private readonly svc: AttestationService,
    @Inject(ATTESTATION_REPO) private readonly repo: AttestationRepository,
    @Inject(ATTESTATION_NONCE_STORE) private readonly nonceStore: AttestationNonceStore,
  ) {}

  @UseGuards(JwtGuard)
  @Post('nonce')
  async issueNonce(@CurrentOperator() op: OperatorContext): Promise<{ nonce: string }> {
    const nonce = await this.nonceStore.issue(op.operatorId);
    return { nonce };
  }

  @UseGuards(JwtGuard)
  @Post('verify')
  async verify(@CurrentOperator() op: OperatorContext, @Body() body: VerifyBody): Promise<{ verified: true }> {
    const parsed = VerifyBodySchema.parse(body);
    const expectedNonce = await this.nonceStore.consume(op.operatorId);
    if (expectedNonce === null) throw new UnauthorizedException('no nonce issued for this operator');
    const outcome = await this.svc.verify({ platform: parsed.platform, token: parsed.token, expectedNonce, ...(parsed.keyId === undefined ? {} : { keyId: parsed.keyId }) });
    if (outcome.kind !== 'ok') throw new ForbiddenException(`attestation rejected: ${outcome.kind}`);
    const tokenHashHex = createHash('sha256').update(parsed.token).digest('hex');
    await this.repo.markAttestationVerified({
      deviceId: parsed.deviceId,
      platform: parsed.platform,
      tokenHashHex,
      publicKeySpkiBase64: outcome.publicKeySpkiBase64,
      securityLevel: outcome.securityLevel,
      environment: outcome.environment,
      keyId: outcome.keyId,
    });
    return { verified: true };
  }
}
