// apps/api/src/auth/passkey-authentication.service.ts
// Orchestrates WebAuthn authentication: options + assertion verification + sign_count update.
// Usernameless flow: client picks credential, we look up driver via credential_id.
// Returns LoginClaims (same shape as AuthLoginService) so the controller can reuse signJwt.
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import {
  decidePasskeyAuthenticationOutcome,
  type PasskeyAuthenticationCandidate,
} from './passkey-authentication-policy.js';
import type { LoginClaims } from './auth-login-policy.js';
import type { PasskeyCredentialRepository } from './passkey-credential.repository.js';

export interface CredentialOwner {
  readonly driverId: string;
  readonly companyId: string;
  readonly businessUnitId: string;
  readonly depotId: string;
  readonly legalEntityId: string;
  readonly operatorId: string | null;
  readonly active: boolean;
  readonly storedSignCount: number;
}

export type CredentialLookupFn = (credentialId: Buffer) => Promise<CredentialOwner | null>;

export type GenerateAuthenticationOptionsFn = (input: {
  rpID: string;
}) => Promise<{ challenge: string; rpId: string; timeout: number }>;

export type VerifyAuthenticationResponseFn = (input: {
  response: unknown;
  expectedChallenge: string;
  expectedRPID: string;
  expectedOrigin: string | string[];
  credential: {
    id: string;
    publicKey: Uint8Array;
    counter: number;
    transports?: readonly string[];
  };
}) => Promise<{
  verified: boolean;
  authenticationInfo?: { newCounter: number; credentialID: string };
}>;

export interface ChallengeStore {
  put(key: string, challenge: string): Promise<void>;
  take(key: string): Promise<string | null>;
}

export interface PasskeyAuthenticationConfig {
  readonly rpId: string;
  readonly expectedOrigin?: string | string[];
}

export interface FinishAuthenticationResult {
  readonly claims: LoginClaims;
}

export class PasskeyAuthenticationService {
  constructor(
    private readonly lookupByCredentialId: CredentialLookupFn,
    private readonly generateOptions: GenerateAuthenticationOptionsFn,
    private readonly verifyResponse: VerifyAuthenticationResponseFn,
    private readonly repo: PasskeyCredentialRepository,
    private readonly challengeStore: ChallengeStore,
    private readonly config: PasskeyAuthenticationConfig,
  ) {}

  async beginAuthentication(): Promise<{ challenge: string; rpId: string; timeout: number }> {
    const opts = await this.generateOptions({ rpID: this.config.rpId });
    await this.challengeStore.put(opts.challenge, opts.challenge);
    return opts;
  }

  async finishAuthentication(
    response: { id: string } & Record<string, unknown>,
    challenge: string,
  ): Promise<FinishAuthenticationResult> {
    const expectedChallenge = await this.challengeStore.take(challenge);
    if (expectedChallenge === null) throw new UnauthorizedException('no_challenge');
    const credentialIdBuf = Buffer.from(response.id, 'base64url');
    const stored = await this.repo.findByCredentialId(credentialIdBuf);
    if (stored === null) throw new UnauthorizedException('credential_not_found');
    const defaultOrigin = 'https://' + this.config.rpId;
    const transports =
      stored.transports !== null ? (stored.transports.split(',') as readonly string[]) : undefined;
    const verification = await this.verifyResponse({
      response,
      expectedChallenge,
      expectedRPID: this.config.rpId,
      expectedOrigin: this.config.expectedOrigin ?? defaultOrigin,
      credential: {
        id: response.id,
        publicKey: new Uint8Array(stored.publicKey) as never,
        counter: stored.signCount,
        ...(transports !== undefined ? { transports } : {}),
      },
    });
    if (!verification.verified || verification.authenticationInfo === undefined) {
      throw new UnauthorizedException('assertion_failed');
    }
    const owner = await this.lookupByCredentialId(credentialIdBuf);
    const candidate: PasskeyAuthenticationCandidate | null =
      owner === null
        ? null
        : {
            driverId: owner.driverId,
            companyId: owner.companyId,
            businessUnitId: owner.businessUnitId,
            depotId: owner.depotId,
            legalEntityId: owner.legalEntityId,
            operatorId: owner.operatorId,
            active: owner.active,
            storedSignCount: owner.storedSignCount,
          };
    const outcome = decidePasskeyAuthenticationOutcome(
      candidate,
      verification.authenticationInfo.newCounter,
    );
    switch (outcome.kind) {
      case 'credential-not-found':
      case 'missing-operator':
      case 'cloned-authenticator':
        throw new UnauthorizedException(outcome.kind);
      case 'disabled':
        throw new ForbiddenException('disabled');
      case 'ok':
        await this.repo.updateSignCountAndLastUsed(credentialIdBuf, outcome.newSignCount);
        return { claims: outcome.claims };
    }
  }
}
