// apps/api/src/config-client/config-client.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ConfigClientController } from './config-client.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [ConfigClientController],
})

export class ConfigClientModule {}
