/**
 * Authentication ports (spec 08 §1/§6, spec 10 §5). The application layer depends only on
 * these interfaces; concrete crypto (argon2id, HS256 JWT) and persistence (Drizzle) live in
 * infrastructure, keeping use cases framework-free and testable with fakes.
 */

/** Argon2id password hashing (spec 10 §5). */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}

/** Claims embedded in an admin session JWT. */
export interface AdminTokenClaims {
  /** Admin user id. */
  sub: string;
  email: string;
  role: string;
}

/** Signs and verifies admin session tokens (HS256 JWT in the MVP). */
export interface TokenService {
  sign(claims: AdminTokenClaims, ttlSeconds: number): Promise<string>;
  verify(token: string): Promise<AdminTokenClaims>;
}

/** An admin panel account (spec 09 §8). */
export interface AdminUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  isActive: boolean;
}

export interface AdminUserRepository {
  findByEmail(email: string): Promise<AdminUserRecord | null>;
  /** Insert an admin user (used by seeds/bootstrap), returning the stored record. */
  create(input: { email: string; passwordHash: string; role?: string }): Promise<AdminUserRecord>;
}

/** An integrator API key (spec 09 §9). Secrets are stored hashed; plaintext exists only once. */
export interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  webhookSecretHash: string | null;
  scopes: string[];
  /** When non-null, the key may only act on these tenant ids. */
  allowedTenantIds: string[] | null;
  isActive: boolean;
}

export interface ApiKeyRepository {
  findByPrefix(prefix: string): Promise<ApiKeyRecord | null>;
  create(record: {
    name: string;
    keyPrefix: string;
    keyHash: string;
    webhookSecretHash?: string | null;
    scopes: string[];
    allowedTenantIds?: string[] | null;
  }): Promise<ApiKeyRecord>;
}
