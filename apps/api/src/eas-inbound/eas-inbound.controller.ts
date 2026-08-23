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
// warning; finished -> STRUCTURED LOG carrying the installable artifact URL.
//
// WHY finished IS A LOG AND NOT AN ALERT (2026-08-23). It used to be a silent
// 200, defensible while builds were routine: nobody needs paging for success.
// But the payload carries artifacts.buildUrl -- the apk/ipa a driver actually
// installs -- and discarding it left distribution as a manual dashboard visit.
// That became load-bearing the moment OTA was enabled: the drivers' existing
// binaries have expo.modules.updates.ENABLED=false compiled into
// AndroidManifest.xml, so they can never receive an update, and the ONE
// reinstall that fixes that forever needs this link.
//
// A LOG, NOT A SENTRY EVENT. Sentry here is the ERROR channel (fatal for
// errored, warning for canceled). Routing successes there is textbook alert
// fatigue -- it makes the fatal ones easier to ignore. The api now emits
// structured JSON through pino, so a log line is queryable on its own. captureMessage is non-blocking, so the 200
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
import { Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(EasInboundController.name);
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
    } else if (build.status === 'finished') {
      // The object lands NESTED under `message` -- nestjs-pino's NativeLogger
      // keeps NestJS argument semantics, so logger.log({...}) serialises as
      // {"message":{...}} rather than spreading the keys to the top level.
      // Still fully queryable (message.installUrl), and stated here because the
      // obvious assumption -- that these become flat fields -- is wrong, and a
      // dashboard query written against the wrong shape silently returns
      // nothing.
      //
      // A missing buildUrl is NOT a failure: Expo omits it for builds that
      // produce no downloadable artifact. Logged as null so the absence is
      // VISIBLE rather than indistinguishable from no delivery at all.
      this.logger.log({
        event: 'eas.build.finished',
        buildId: build.id,
        platform: build.platform ?? 'unknown',
        buildProfile: build.metadata?.buildProfile ?? 'unknown',
        appVersion: build.metadata?.appVersion ?? 'unknown',
        installUrl: build.artifacts?.buildUrl ?? null,
        detailsUrl: build.buildDetailsPageUrl ?? null,
      });
    }
    return { received: true };
  }
}
