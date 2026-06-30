import { z } from 'zod';
import type { AdminUserRepository, PasswordHasher, TokenService } from '../ports/index.js';
import { unauthorized, validate } from '../shared/errors.js';

/** Admin session lifetime (spec 08 §1 — short-lived bearer tokens). */
export const ADMIN_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

const LoginInputSchema = z.object({
  email: z.string().email('INVALID_EMAIL'),
  password: z.string().min(1, 'PASSWORD_REQUIRED'),
});

export interface LoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  admin: { id: string; email: string; role: string };
}

export interface LoginAdminDeps {
  admins: AdminUserRepository;
  hasher: PasswordHasher;
  tokens: TokenService;
  ttlSeconds?: number;
}

/**
 * Admin login (spec 08 §1, TASK-020). Verifies the argon2id password hash and issues a
 * short-lived HS256 JWT. Failures are deliberately indistinguishable (unknown email, wrong
 * password, inactive account all return the same `401 UNAUTHENTICATED`) to avoid user
 * enumeration (spec 10 §7).
 */
export class LoginAdmin {
  constructor(private readonly deps: LoginAdminDeps) {}

  async execute(rawInput: unknown): Promise<LoginResult> {
    const input = validate(LoginInputSchema, rawInput);
    const ttl = this.deps.ttlSeconds ?? ADMIN_TOKEN_TTL_SECONDS;

    const user = await this.deps.admins.findByEmail(input.email);
    const ok =
      user && user.isActive && (await this.deps.hasher.verify(input.password, user.passwordHash));
    if (!user || !ok) {
      throw unauthorized('UNAUTHENTICATED', 'Invalid credentials');
    }

    const accessToken = await this.deps.tokens.sign(
      { sub: user.id, email: user.email, role: user.role },
      ttl,
    );
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: ttl,
      admin: { id: user.id, email: user.email, role: user.role },
    };
  }
}
