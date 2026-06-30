import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApplicationError } from '../../application/shared/errors.js';
import type { AdminTokenClaims, TokenService } from '../../application/ports/index.js';

interface JwtPayload extends AdminTokenClaims {
  iat: number;
  exp: number;
}

/**
 * Minimal HS256 JWT service (spec 08 §1 — admin Bearer tokens). Dependency-free (node
 * `crypto`) to keep the api free of a JWT library. Verification is constant-time and checks
 * the `exp` claim; any malformed/expired/forged token raises `401 UNAUTHENTICATED`.
 */
export class HmacJwtService implements TokenService {
  constructor(private readonly secret: string) {}

  async sign(claims: AdminTokenClaims, ttlSeconds: number): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = { ...claims, iat: now, exp: now + ttlSeconds };
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = b64url(JSON.stringify(payload));
    const signature = this.signature(`${header}.${body}`);
    return `${header}.${body}.${signature}`;
  }

  async verify(token: string): Promise<AdminTokenClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw unauthenticated();
    }
    const [header, body, signature] = parts as [string, string, string];
    const expected = this.signature(`${header}.${body}`);
    if (!constantTimeEquals(signature, expected)) {
      throw unauthenticated();
    }
    let payload: JwtPayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JwtPayload;
    } catch {
      throw unauthenticated();
    }
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
      throw unauthenticated();
    }
    return { sub: payload.sub, email: payload.email, role: payload.role };
  }

  private signature(signingInput: string): string {
    return createHmac('sha256', this.secret).update(signingInput).digest('base64url');
  }
}

function b64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function unauthenticated(): ApplicationError {
  return new ApplicationError('UNAUTHENTICATED', 'Invalid or expired token', 401);
}
