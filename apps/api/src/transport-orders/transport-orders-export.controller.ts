// apps/api/src/transport-orders/transport-orders-export.controller.ts
//
// T1 (2026) Lệnh điều xe Excel export HTTP surface:
//
//   GET  /transport-orders/export.xlsx       -> binary download (manual)
//   POST /transport-orders/export/auto       -> {trigger:'login'|'logout'}
//                                               idempotent per VN-tz day
//
// JwtGuard + CurrentOperator pattern mirrors DispatchController so the
// caller's tenancy is taken from the JWT claims (no IDOR via query
// string). The manual endpoint streams the .xlsx Buffer with the
// canonical Content-Disposition filename so the browser triggers a
// download. The auto endpoint is fire-and-forget from the ops-web
// login.action.ts / logout.action.ts; it returns a short JSON
// summary so the caller can log without holding the binary.
import { Body, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ExportQuerySchema, type ExportQuery } from '@fleet/sync-protocol';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
import { TransportOrdersExportService, type ExportResult } from './transport-orders-export.service.js';
// 'manual' is intentionally excluded — manual exports go through the GET
// endpoint that streams the binary. Auto endpoint is for backup ledger
// rows only.
const AutoExportSchema = z.object({
  trigger: z.enum(['login', 'logout']),
}).strict();
export interface AutoExportResponse {
  readonly exportLogId: string;
  readonly trigger: 'login' | 'logout';
  readonly dayKey: string;
  readonly rowCount: number;
  readonly sha256: string;
  readonly filename: string;
}
@Controller('/')
@UseGuards(JwtGuard)
export class TransportOrdersExportController {
  constructor(private readonly svc: TransportOrdersExportService) {}
  // GET /transport-orders/export.xlsx maps via the @Get('transport-orders-export.xlsx') member
  // path; combined with the controller base path this resolves to
  // /transport-orders/export.xlsx.
  @Get('transport-orders-export.xlsx')
  async exportXlsx(
    @Query() query: Record<string, unknown>,
    @CurrentOperator() op: OperatorContext,
    @Res() res: Response,
  ): Promise<void> {
    // T67: the export mirrors the dispatcher ACTIVE board view -- day range PLUS
    // free-text search term PLUS status tab. ExportQuerySchema is the SSOT the
    // ops-web server action builds against, so the query string cannot drift
    // from what the API accepts.
    //
    // Every field is optional, but the schema is .strict() and enforces
    // both-or-neither on from/to, so a partial range or a typo-d key is a 400
    // rather than a 200 carrying the WHOLE board while looking bounded -- the
    // query-parameter silent-failure anti-pattern this arc exists to close.
    //
    // An EMPTY query collapses to undefined, preserving the unfiltered
    // login/logout daily-backup ledger semantics exactly as before.
    const parsed: ExportQuery = ExportQuerySchema.parse(query);
    const filter: ExportQuery | undefined = Object.keys(parsed).length === 0 ? undefined : parsed;
    const result: ExportResult = await this.svc.exportAndLog(op, 'manual', filter);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=' + String.fromCharCode(34) + result.filename + String.fromCharCode(34));
    res.setHeader('Content-Length', String(result.buffer.byteLength));
    res.send(result.buffer);
  }
  @Post('transport-orders-export/auto')
  async exportAuto(
    @Body() body: unknown,
    @CurrentOperator() op: OperatorContext,
  ): Promise<AutoExportResponse> {
    const parsed = AutoExportSchema.parse(body);
    const result = await this.svc.exportAndLog(op, parsed.trigger);
    return {
      exportLogId: result.exportLogId,
      trigger: parsed.trigger,
      dayKey: result.dayKey,
      rowCount: result.rowCount,
      sha256: result.sha256,
      filename: result.filename,
    };
  }
}
