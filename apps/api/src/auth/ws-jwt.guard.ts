// apps/api/src/auth/ws-jwt.guard.ts
// WebSocket JWT guard per PDF §"Session/revocation": "Surface + session
// mode attached at issue; resolved from device_session in HTTP + WS guards."
// Reuses IIdentityProvider (same trust chain as HTTP JwtGuard).
//
// Token resolution precedence:
//   1. handshake.auth.token  (preferred — set by socket.io-client `auth: { token }`)
//   2. Authorization: Bearer <token>  (fallback for clients that share HTTP auth)
//
// On success: attaches AuthenticatedSocketData to client.data; downstream
// handlers read operatorId/companyId from verified identity, never from
// raw handshake. This closes the spoofing surface that compromised
// CommandsGateway.handleAck ownership checks.
//
// Pilot scope: revocation check (PDF §"Realtime: revocation check at every
// room join") deferred — needs Redis fast-path hint cache. Token expiry
// (exp claim) is enforced by IIdentityProvider.verifyToken which is
// sufficient for pilot.
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Socket } from 'socket.io';
import {
  IDENTITY_PROVIDER,
  type IIdentityProvider,
  type VerifiedIdentity,
} from './identity-provider.interface.js';
import type { OperatorContext } from './operator-context.js';
import { OperatorContextFactory } from './operator-context.factory.js';

export interface AuthenticatedSocketData {
  readonly identity: VerifiedIdentity;
  readonly fleetOperator: OperatorContext;
}

interface HandshakeShape {
  readonly auth: Record<string, unknown>;
  readonly headers: Record<string, string | undefined>;
}

function extractToken(handshake: HandshakeShape): string | undefined {
  const fromAuth = handshake.auth['token'];
  if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;
  const header = handshake.headers['authorization'];
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length);
  }
  return undefined;
}

@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(
    @Inject(IDENTITY_PROVIDER) private readonly idp: IIdentityProvider,
    private readonly operatorFactory: OperatorContextFactory,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const client = ctx.switchToWs().getClient<Socket>();
    const handshake = client.handshake as unknown as HandshakeShape;
    const token = extractToken(handshake);
    if (token === undefined) {
      throw new UnauthorizedException('Missing WS auth token');
    }
    try {
      const identity = await this.idp.verifyToken(token);
      const fleetOperator = this.operatorFactory.fromIdentity(identity);
      const authed: AuthenticatedSocketData = { identity, fleetOperator };
      Object.assign(client.data as Record<string, unknown>, authed);
      return true;
    } catch (err) {
      this.logger.warn(`WS token verification failed: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid WS token');
    }
  }
}
