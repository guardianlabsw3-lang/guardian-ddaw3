import { describe, expect, it } from 'vitest';
import type {
  AdminUserRecord,
  AdminUserRepository,
  PasswordHasher,
} from '../../application/ports/index.js';
import { ensureAdminUser } from './ensure-admin.js';

class FakeAdminRepo implements AdminUserRepository {
  readonly byEmail = new Map<string, AdminUserRecord>();
  createCalls = 0;

  async findByEmail(email: string): Promise<AdminUserRecord | null> {
    return this.byEmail.get(email.toLowerCase()) ?? null;
  }
  async create(input: {
    email: string;
    passwordHash: string;
    role?: string;
  }): Promise<AdminUserRecord> {
    this.createCalls += 1;
    const record: AdminUserRecord = {
      id: `id-${this.createCalls}`,
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      role: input.role ?? 'admin',
      isActive: true,
    };
    this.byEmail.set(record.email, record);
    return record;
  }
}

const hasher: PasswordHasher = {
  async hash(plain) {
    return `hashed:${plain}`;
  },
  async verify(plain, hash) {
    return hash === `hashed:${plain}`;
  },
};

describe('ensureAdminUser', () => {
  it('creates a normalized admin when none exists', async () => {
    const admins = new FakeAdminRepo();
    const result = await ensureAdminUser(admins, hasher, {
      email: 'Root@Acme.LOCAL',
      password: 'sup3r-secret-pass',
    });
    expect(result).toEqual({ created: true, email: 'root@acme.local' });
    expect(admins.byEmail.get('root@acme.local')?.passwordHash).toBe('hashed:sup3r-secret-pass');
  });

  it('is idempotent and never resets an existing password', async () => {
    const admins = new FakeAdminRepo();
    await ensureAdminUser(admins, hasher, { email: 'a@b.com', password: 'first-password' });
    const second = await ensureAdminUser(admins, hasher, {
      email: 'A@B.com',
      password: 'a-different-password',
    });
    expect(second).toEqual({ created: false, email: 'a@b.com' });
    expect(admins.createCalls).toBe(1);
    expect(admins.byEmail.get('a@b.com')?.passwordHash).toBe('hashed:first-password');
  });

  it('rejects a password shorter than the minimum', async () => {
    const admins = new FakeAdminRepo();
    await expect(
      ensureAdminUser(admins, hasher, { email: 'a@b.com', password: 'short' }),
    ).rejects.toThrow(/at least 8/);
    expect(admins.createCalls).toBe(0);
  });

  it('rejects a malformed email', async () => {
    const admins = new FakeAdminRepo();
    await expect(
      ensureAdminUser(admins, hasher, { email: 'not-an-email', password: 'sup3r-secret-pass' }),
    ).rejects.toThrow();
    expect(admins.createCalls).toBe(0);
  });
});
