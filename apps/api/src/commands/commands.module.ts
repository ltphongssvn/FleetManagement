// apps/api/src/commands/commands.module.ts
import { Module } from '@nestjs/common';
import { CommandsController } from './commands.controller.js';
import { CommandsGateway } from './commands.gateway.js';
import { CommandsService } from './commands.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PushModule } from '../push/push.module.js';

@Module({
  imports: [AuthModule, DatabaseModule, PushModule],
  controllers: [CommandsController],
  providers: [CommandsGateway, CommandsService],
  exports: [CommandsGateway],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class CommandsModule {}
