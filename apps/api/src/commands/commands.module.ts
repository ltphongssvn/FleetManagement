// apps/api/src/commands/commands.module.ts
import { Module } from '@nestjs/common';
import { CommandsGateway } from './commands.gateway.js';
import { PushModule } from '../push/push.module.js';

@Module({
  imports: [PushModule],
  providers: [CommandsGateway],
  exports: [CommandsGateway],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class CommandsModule {}
