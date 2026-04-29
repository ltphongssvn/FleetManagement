// apps/api/src/dispatch/dispatch.module.ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { DispatchController } from './dispatch.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [DispatchController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class DispatchModule {}
