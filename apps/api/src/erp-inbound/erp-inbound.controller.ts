// apps/api/src/erp-inbound/erp-inbound.controller.ts
// Inbound ERP webhook. HMAC-SHA256 over JSON body using ERP_WEBHOOK_SECRET.
// PDF Day-One #8: "Inbound ERP sync: deferred to pilot week 4".
// Factor III: ERP_WEBHOOK_SECRET is read from the validated ConfigService
// boundary (declared optional in EnvSchema), never raw process.env. Unset ->
// verifier stays fail-closed (rejects every delivery as unverifiable).
import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { InvoiceAckSchema, type InvoiceAckInput } from './erp-inbound.dto.js';
import { ErpInboundService } from './erp-inbound.service.js';
function verifySignature(
  body: InvoiceAckInput,
  sig: string | undefined,
  secret: string | undefined,
): void {
  if (!sig) throw new UnauthorizedException('missing signature header');
  if (!secret) throw new UnauthorizedException('signature verification unavailable');
  const expected = createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  const a = Buffer.from(expected, 'hex');
  let b: Buffer;
  try {
    b = Buffer.from(sig, 'hex');
  } catch {
    throw new UnauthorizedException('invalid signature');
  }
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new UnauthorizedException('invalid signature');
  }
}
@Controller('erp/inbound')
export class ErpInboundController {
  constructor(
    private readonly svc: ErpInboundService,
    private readonly config: ConfigService,
  ) {}
  @Post('invoice-ack')
  async invoiceAck(
    @Body() body: unknown,
    @Headers('x-erp-signature') sig: string | undefined,
  ): Promise<{ updated: boolean }> {
    const input = InvoiceAckSchema.parse(body);
    const secret = this.config.get<string>('ERP_WEBHOOK_SECRET');
    verifySignature(input, sig, secret);
    return this.svc.recordInvoiceAck(input);
  }
}
