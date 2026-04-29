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
