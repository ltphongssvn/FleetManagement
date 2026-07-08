// apps/api/src/eas-inbound/eas-inbound.module.ts
import { Module } from '@nestjs/common';
import { EasInboundController } from './eas-inbound.controller.js';
@Module({
  controllers: [EasInboundController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class EasInboundModule {}
