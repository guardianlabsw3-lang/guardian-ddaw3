import { z } from 'zod';
import type { AdminUserRepository, PasswordHasher, TokenService } from '../ports/index.js';
import { conflict, validate } from '../shared/errors.js';
import { ADMIN_TOKEN_TTL_SECONDS, type LoginResult } from './login-admin.js';

/** Minimum admin password length (spec 10 §5 — argon2id hashed at rest). */
export const ADMIN_PASSWORD_MIN_LENGTH = 8;

const RegisterInputSchema = z.object({
  email: z.string().email('INVALID_EMAIL'),
  password: z.string().min(ADMIN_PASSWORD_MIN_LENGTH, 'PASSWORD_TOO_SHORT'),
});

export interface RegisterAdminDeps {
  admins: AdminUserRepository;
  hasher: PasswordHasher;
  tokens: TokenService;
  ttlSeconds?: number;
}

/**
 * Admin self-registration (spec 08 §1). Creates a new admin panel account with an argon2id
 * password hash and immediately issues a short-lived HS256 JWT so the client can proceed
 * without a second round-trip — the same `LoginResult` shape the login use case returns.
 * A duplicate email is rejected with `409 EMAIL_ALREADY_REGISTERED`.
 */
export class RegisterAdmin {
  constructor(private readonly deps: RegisterAdminDeps) {}

  async execute(rawInput: unknown): Promise<LoginResult> {
    const input = validate(RegisterInputSchema, rawInput);
    const ttl = this.deps.ttlSeconds ?? ADMIN_TOKEN_TTL_SECONDS;

    const existing = await this.deps.admins.findByEmail(input.email);
    if (existing) {
      throw conflict('EMAIL_ALREADY_REGISTERED', 'Email already registered');
    }

    const passwordHash = await this.deps.hasher.hash(input.password);
    const user = await this.deps.admins.create({ email: input.email, passwordHash });

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
