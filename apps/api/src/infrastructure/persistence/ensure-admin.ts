import { EmailSchema } from '@payorder/shared';
import type { AdminUserRepository, PasswordHasher } from '../../application/ports/index.js';
import { ADMIN_PASSWORD_MIN_LENGTH } from '../../application/auth/index.js';

export interface EnsureAdminInput {
  email: string;
  password: string;
  role?: string;
}

export interface EnsureAdminResult {
  /** True when a new account was inserted; false when one already existed. */
  created: boolean;
  /** The normalized (lower-cased) email the account is keyed by. */
  email: string;
}

/**
 * Idempotently ensure an admin panel account exists, sharing the local seed and the production
 * `bootstrap-admin` one-shot. The email is normalized and validated, and the password is held
 * to the same minimum length as self-registration (spec 10 §5) so a bootstrap can never create
 * a weaker credential than the API would accept.
 *
 * An **existing** account is left untouched — a re-run must never silently reset a rotated
 * password. Changing an admin's password is a separate, explicit operation.
 */
export async function ensureAdminUser(
  admins: AdminUserRepository,
  hasher: PasswordHasher,
  input: EnsureAdminInput,
): Promise<EnsureAdminResult> {
  const email = EmailSchema.parse(input.email).toLowerCase();
  if (input.password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    throw new Error(`admin password must be at least ${ADMIN_PASSWORD_MIN_LENGTH} characters`);
  }

  const existing = await admins.findByEmail(email);
  if (existing) {
    return { created: false, email };
  }

  await admins.create({
    email,
    passwordHash: await hasher.hash(input.password),
    role: input.role ?? 'admin',
  });
  return { created: true, email };
}
