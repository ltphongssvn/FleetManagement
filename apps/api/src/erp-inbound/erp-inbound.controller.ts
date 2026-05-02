// apps/api/src/erp-inbound/erp-inbound.controller.ts
// Inbound ERP webhook. HMAC-SHA256 over JSON body using ERP_WEBHOOK_SECRET.
// PDF Day-One #8: "Inbound ERP sync: deferred to pilot week 4".
import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { InvoiceAckSchema, type InvoiceAckInput } from './erp-inbound.dto.js';
import { ErpInboundService } from './erp-inbound.service.js';

function verifySignature(body: InvoiceAckInput, sig: string | undefined): void {
  if (!sig) throw new UnauthorizedException('missing signature header');
  const secret = process.env['ERP_WEBHOOK_SECRET'];
  if (!secret) throw new UnauthorizedException('signature verification unavailable');
  const expected = createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  const a = Buffer.from(expected, 'hex');
  let b: Buffer;
  try { b = Buffer.from(sig, 'hex'); } catch { throw new UnauthorizedException('invalid signature'); }
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new UnauthorizedException('invalid signature');
  }
}

@Controller('erp/inbound')
export class ErpInboundController {
  constructor(private readonly svc: ErpInboundService) {}

  @Post('invoice-ack')
  async invoiceAck(
    @Body() body: unknown,
    @Headers('x-erp-signature') sig: string | undefined,
  ): Promise<{ updated: boolean }> {
    const input = InvoiceAckSchema.parse(body);
    verifySignature(input, sig);
    return this.svc.recordInvoiceAck(input);
  }
}
