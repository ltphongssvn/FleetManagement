// apps/api/src/manifest/manifest.controller.ts
import { Body, Controller, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ManifestRejectionReasonSchema } from '@fleet/domain';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
import {
  CommitUploadSchema,
  NegotiateUploadSchema,
  SetManualNetWeightSchema,
  type CommitUploadInput,
  type CommitUploadResponse,
  type NegotiateUploadInput,
  type NegotiateUploadResponse,
} from './manifest.dto.js';
import { ExtractionResultWireSchema, type ExtractionResultWire } from '@fleet/sync-protocol';
import { ManifestService } from './manifest.service.js';
// OperatorContextFactory wires fleetOperator onto every authenticated request
// via JwtGuard. Controller pulls from request, never hardcodes tenancy IDs.
@Controller('upload')
@UseGuards(JwtGuard)
export class ManifestController {
  constructor(private readonly manifests: ManifestService) {}
  @Post('negotiate')
  async negotiate(
    @Body() body: unknown,
    @CurrentOperator() op: OperatorContext,
  ): Promise<NegotiateUploadResponse> {
    const input: NegotiateUploadInput = NegotiateUploadSchema.parse(body);
    return this.manifests.negotiateUpload(input, op);
  }
  @Post('commit')
  async commit(
    @Body() body: unknown,
    @CurrentOperator() op: OperatorContext,
  ): Promise<CommitUploadResponse> {
    const input: CommitUploadInput = CommitUploadSchema.parse(body);
    return this.manifests.commitUpload(input, op);
  }
}
const FinalizeIntakeSchema = z
  .object({
    uploadSessionId: z.guid(),
    accepted: z.boolean(),
    rejectionReasonCode: ManifestRejectionReasonSchema.optional(),
  })
  .strict();
@Controller('upload')
@UseGuards(JwtGuard)
export class IntakeCallbackController {
  constructor(private readonly manifests: ManifestService) {}
  @Post('intake-result')
  async finalize(
    @Body() body: unknown,
    @CurrentOperator() op: OperatorContext,
  ): Promise<{ manifestId: string; state: 'committed' | 'rejected' }> {
    const parsed = FinalizeIntakeSchema.parse(body);
    const input =
      parsed.rejectionReasonCode === undefined
        ? { uploadSessionId: parsed.uploadSessionId, accepted: parsed.accepted }
        : {
            uploadSessionId: parsed.uploadSessionId,
            accepted: parsed.accepted,
            rejectionReasonCode: parsed.rejectionReasonCode,
          };
    return this.manifests.finalizeIntake(input, op);
  }
}
// Worker -> API callback for the phieu-can net-weight extraction result.
// Body is strict-parsed against the SSOT ExtractionResultWireSchema
// (@fleet/sync-protocol) — same schema the worker uses to BUILD the request,
// so the boundary cannot drift (closes the intake-callback API-local-schema gap).
@Controller('upload')
@UseGuards(JwtGuard)
export class ExtractionCallbackController {
  constructor(private readonly manifests: ManifestService) {}
  @Post('extraction-result')
  async finalize(
    @Body() body: unknown,
    @CurrentOperator() op: OperatorContext,
  ): Promise<{ manifestId: string; status: ExtractionResultWire['status'] }> {
    const parsed: ExtractionResultWire = ExtractionResultWireSchema.parse(body);
    return this.manifests.finalizeExtraction(parsed, op);
  }
}

// Dispatcher manual net-weight entry (board edit, gap 1). PATCH /upload/manual-net-weight
// strict-parses SetManualNetWeightSchema and dispatches to
// ManifestService.setManualNetWeight. Same guard + tenancy-from-request pattern
// as the worker callback; lets a dispatcher correct a not_found/unreadable/wrong
// extraction without a DBA running SQL.
@Controller('upload')
@UseGuards(JwtGuard)
export class ManualNetWeightController {
  constructor(private readonly manifests: ManifestService) {}
  @Patch('manual-net-weight')
  async setManual(
    @Body() body: unknown,
    @CurrentOperator() op: OperatorContext,
  ): Promise<{ manifestId: string; status: 'manual' }> {
    const parsed = SetManualNetWeightSchema.parse(body);
    return this.manifests.setManualNetWeight(parsed, op);
  }
}
