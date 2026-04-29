// apps/api/src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JoseIdentityProvider } from './jose-identity-provider.js';
import { JwtGuard } from './jwt.guard.js';
import { OperatorContextFactory } from './operator-context.factory.js';
import { IDENTITY_PROVIDER } from './identity-provider.interface.js';

@Module({
  providers: [
    { provide: IDENTITY_PROVIDER, useClass: JoseIdentityProvider },
    JwtGuard,
    OperatorContextFactory,
  ],
  exports: [IDENTITY_PROVIDER, JwtGuard, OperatorContextFactory],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AuthModule {}
