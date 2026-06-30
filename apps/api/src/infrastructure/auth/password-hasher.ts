import { randomBytes } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';
import type { PasswordHasher } from '../../application/ports/index.js';

/**
 * Argon2id password hasher (spec 10 §5) backed by `hash-wasm` (pure WASM, no native build —
 * reliable in CI). Parameters follow current OWASP guidance for argon2id (19 MiB memory, 2
 * iterations, parallelism 1). Output is the standard PHC-encoded string, so `verify` is
 * self-describing and parameters can evolve without a schema change.
 */
export class Argon2PasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    return argon2id({
      password: plain,
      salt: randomBytes(16),
      parallelism: 1,
      iterations: 2,
      memorySize: 19456,
      hashLength: 32,
      outputType: 'encoded',
    });
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    try {
      return await argon2Verify({ password: plain, hash });
    } catch {
      return false;
    }
  }
}
