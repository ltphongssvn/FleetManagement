// apps/api/src/manifest/manifest.controller.ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard.js';
import { NegotiateUploadSchema, CommitUploadSchema, type NegotiateUploadInput, type NegotiateUploadResponse, type CommitUploadInput, type CommitUploadResponse } from './manifest.dto.js';
import { ManifestService } from './manifest.service.js';
import { PILOT_OPERATOR_CONTEXT } from './pilot-operator-context.js';

@Controller('upload')
@UseGuards(JwtGuard)
export class ManifestController {
  constructor(private readonly manifests: ManifestService) {}

  @Post('negotiate')
  async negotiate(@Body() body: unknown): Promise<NegotiateUploadResponse> {
    const input: NegotiateUploadInput = NegotiateUploadSchema.parse(body);

    return this.manifests.negotiateUpload(input, PILOT_OPERATOR_CONTEXT);
  }

  @Post('commit')
  async commit(@Body() body: unknown): Promise<CommitUploadResponse> {
    const input: CommitUploadInput = CommitUploadSchema.parse(body);
    return this.manifests.commitUpload(input, PILOT_OPERATOR_CONTEXT);
  }
}
