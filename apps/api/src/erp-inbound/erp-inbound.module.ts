// apps/api/src/erp-inbound/erp-inbound.module.ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ErpInboundController } from './erp-inbound.controller.js';
import { ErpInboundService } from './erp-inbound.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [ErpInboundController],
  providers: [ErpInboundService],
})

export class ErpInboundModule {}
