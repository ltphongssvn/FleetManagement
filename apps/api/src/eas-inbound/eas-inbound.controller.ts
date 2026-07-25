// apps/api/src/eas-inbound/eas-inbound.controller.ts
// Inbound EAS BUILD webhook -- the OFF-runner completion gate for
// eas-driver-build.yml (--no-wait). Pipeline: verify -> dedup -> alert -> ACK.
// Expo signs the RAW request body: expo-signature: sha1=<hex HMAC-SHA1 with
// EAS_WEBHOOK_SECRET>, so verification runs over req.rawBody (bootstrap sets
// rawBody:true) -- NEVER a re-serialized JSON.stringify(body), which is not
// byte-stable. Signature is checked BEFORE anything else so a spoofed/replayed
// body never reaches dedup or Sentry. IDEMPOTENCY: EAS delivers at-least-once
// and retries on any non-2xx, so the same build id can arrive more than once;
// EasBuildDedupStore.markSeen (atomic SET NX PX) returns true only on the first
// delivery -- repeats are acknowledged with 200 (so EAS stops retrying) but
// raise NO duplicate Sentry alert. Terminal status: errored -> Sentry fatal
// (house alerting pattern, same as the break-glass login monitor); canceled ->
// warning; finished -> silent 200. captureMessage is non-blocking, so the 200
// still returns immediately (verify -> dedup -> ack, no heavy inline work).
// Factor III: EAS_WEBHOOK_SECRET is read from the validated ConfigService
// boundary (declared optional in EnvSchema), never raw process.env. Unset ->
// verifier stays fail-closed (rejects every delivery as unverifiable).
// Register the webhook once per project:
//   eas webhook:create --event BUILD \
//     --url https://<api>/integrations/eas/build-status \
//     --secret $EAS_WEBHOOK_SECRET
import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import * as Sentry from '@sentry/nestjs';
import { EasBuildWebhookSchema } from './eas-inbound.dto.js';
import { EAS_BUILD_DEDUP, type EasBuildDedupPort } from './eas-build-dedup.store.js';
function verifySignature(raw: Buffer | undefined, sig: string | undefined, secret: string | undefined): void {
  if (!sig) throw new UnauthorizedException('missing signature header');
  if (!raw) throw new UnauthorizedException('raw body unavailable for signature verification');
  if (!secret) throw new UnauthorizedException('signature verification unavailable');
  const hex = sig.startsWith('sha1=') ? sig.slice('sha1='.length) : sig;
  const expected = createHmac('sha1', secret).update(raw).digest();
  let provided: Buffer;
  try { provided = Buffer.from(hex, 'hex'); } catch { throw new UnauthorizedException('invalid signature'); }
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new UnauthorizedException('invalid signature');
  }
}
@Controller('integrations/eas')
export class EasInboundController {
  constructor(
    @Inject(EAS_BUILD_DEDUP) private readonly dedup: EasBuildDedupPort,
    private readonly config: ConfigService,
  ) {}
  @Post('build-status')
  @HttpCode(200)
  async buildStatus(
    @Req() req: RawBodyRequest<Request>,
    @Headers('expo-signature') sig: string | undefined,
  ): Promise<{ received: boolean }> {
    const secret = this.config.get<string>('EAS_WEBHOOK_SECRET');
    verifySignature(req.rawBody, sig, secret);
    const build = EasBuildWebhookSchema.parse(req.body);
    // At-least-once delivery: only the first sighting of this build id alerts.
    const fresh = await this.dedup.markSeen(build.id, build.status);
    if (!fresh) return { received: true };
    if (build.status === 'errored') {
      Sentry.captureMessage('EAS build errored: ' + build.id, {
        level: 'fatal',
        extra: {
          buildId: build.id,
          platform: build.platform ?? 'unknown',
          errorCode: build.error?.errorCode ?? null,
          errorMessage: build.error?.message ?? null,
        },
      });
    } else if (build.status === 'canceled') {
      Sentry.captureMessage('EAS build canceled: ' + build.id, {
        level: 'warning',
        extra: { buildId: build.id, platform: build.platform ?? 'unknown' },
      });
    }
    return { received: true };
  }
}
