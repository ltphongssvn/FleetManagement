// apps/api/src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JoseIdentityProvider } from './jose-identity-provider.js';
import { JwtGuard } from './jwt.guard.js';
import { IDENTITY_PROVIDER } from './identity-provider.interface.js';

@Module({
  providers: [
    { provide: IDENTITY_PROVIDER, useClass: JoseIdentityProvider },
    JwtGuard,
  ],
  exports: [IDENTITY_PROVIDER, JwtGuard],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AuthModule {}
