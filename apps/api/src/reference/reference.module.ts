// apps/api/src/reference/reference.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ReferenceController } from './reference.controller.js';
import { ReferenceService } from './reference.service.js';
@Module({
  imports: [AuthModule],
  controllers: [ReferenceController],
  providers: [ReferenceService],
  exports: [ReferenceService],
})
export class ReferenceModule {}
