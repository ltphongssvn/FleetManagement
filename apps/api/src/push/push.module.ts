// apps/api/src/push/push.module.ts
import { Module } from '@nestjs/common';
import { ExpoPushProvider, EXPO_CLIENT, defaultExpoClient } from './expo-push-provider.js';
import { PUSH_PROVIDER } from './push-provider.interface.js';

@Module({
  providers: [
    { provide: EXPO_CLIENT, useFactory: defaultExpoClient },
    { provide: PUSH_PROVIDER, useClass: ExpoPushProvider },
  ],
  exports: [PUSH_PROVIDER],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class PushModule {}
