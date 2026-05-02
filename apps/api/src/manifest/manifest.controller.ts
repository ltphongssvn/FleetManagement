// apps/api/src/manifest/manifest.controller.ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
import {
  CommitUploadSchema,
  NegotiateUploadSchema,
  type CommitUploadInput,
  type CommitUploadResponse,
  type NegotiateUploadInput,
  type NegotiateUploadResponse,
} from './manifest.dto.js';
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

import { z } from 'zod';

const FinalizeIntakeSchema = z.object({
  uploadSessionId: z.string().uuid(),
  accepted: z.boolean(),
  rejectionReasonCode: z.string().min(1).max(64).optional(),
}).strict();

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
    const input = parsed.rejectionReasonCode === undefined
      ? { uploadSessionId: parsed.uploadSessionId, accepted: parsed.accepted }
      : { uploadSessionId: parsed.uploadSessionId, accepted: parsed.accepted, rejectionReasonCode: parsed.rejectionReasonCode };
    return this.manifests.finalizeIntake(input, op);
  }
}
