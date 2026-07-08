// apps/api/src/eas-inbound/eas-inbound.controller.ts
// Inbound EAS BUILD webhook -- the OFF-runner completion gate for
// eas-driver-build.yml (--no-wait). Expo signs the RAW request body:
// expo-signature: sha1=<hex HMAC-SHA1 with EAS_WEBHOOK_SECRET>, so
// verification runs over req.rawBody (bootstrap sets rawBody:true) --
// NEVER a re-serialized JSON.stringify(body), which is not byte-stable.
// errored -> Sentry fatal (house alerting pattern, same as the break-glass
// login monitor); canceled -> warning; finished -> silent 200.
// Register the webhook once per project:
//   eas webhook:create --event BUILD \
//     --url https://<api>/integrations/eas/build-status \
//     --secret $EAS_WEBHOOK_SECRET
import {
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import * as Sentry from '@sentry/nestjs';
import { EasBuildWebhookSchema } from './eas-inbound.dto.js';

function verifySignature(raw: Buffer | undefined, sig: string | undefined): void {
  if (!sig) throw new UnauthorizedException('missing signature header');
  if (!raw) throw new UnauthorizedException('raw body unavailable for signature verification');
  const secret = process.env['EAS_WEBHOOK_SECRET'];
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
  @Post('build-status')
  @HttpCode(200)
  buildStatus(
    @Req() req: RawBodyRequest<Request>,
    @Headers('expo-signature') sig: string | undefined,
  ): { received: boolean } {
    verifySignature(req.rawBody, sig);
    const build = EasBuildWebhookSchema.parse(req.body);
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
