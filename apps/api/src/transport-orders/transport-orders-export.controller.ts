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
import { ExportDateRangeSchema, type ExportDateRange } from '@fleet/sync-protocol';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
import {
  TransportOrdersExportService,
  type ExportResult,
} from './transport-orders-export.service.js';
// 'manual' is intentionally excluded — manual exports go through the GET
// endpoint that streams the binary. Auto endpoint is for backup ledger
// rows only.
const AutoExportSchema = z
  .object({
    trigger: z.enum(['login', 'logout']),
  })
  .strict();
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
    // Feature 4: optional dispatcher-selected inclusive day-range. Only when BOTH
    // from and to are present do we validate + apply a range; a partial/absent
    // range exports everything (unchanged behavior). ExportDateRangeSchema is the
    // SSOT (YYYY-MM-DD format + from<=to); an invalid range throws -> 400, never a
    // silent empty export.
    let range: ExportDateRange | undefined;
    if (query['from'] !== undefined && query['to'] !== undefined) {
      range = ExportDateRangeSchema.parse({ from: query['from'], to: query['to'] });
    }
    const result: ExportResult = await this.svc.exportAndLog(op, 'manual', range);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=' + String.fromCharCode(34) + result.filename + String.fromCharCode(34),
    );
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
