import { eq } from 'drizzle-orm';
import type { AdminUserRecord, AdminUserRepository } from '../../application/ports/index.js';
import type { Database } from '../persistence/db.js';
import { adminUsers } from '../persistence/schema/access.js';

/** Drizzle-backed `AdminUserRepository` over `admin_users` (spec 09 §8). */
export class DrizzleAdminUserRepository implements AdminUserRepository {
  constructor(private readonly db: Database) {}

  async findByEmail(email: string): Promise<AdminUserRecord | null> {
    const [row] = await this.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.email, email.toLowerCase()))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async create(input: {
    email: string;
    passwordHash: string;
    role?: string;
  }): Promise<AdminUserRecord> {
    const [row] = await this.db
      .insert(adminUsers)
      .values({
        email: input.email.toLowerCase(),
        passwordHash: input.passwordHash,
        role: input.role ?? 'admin',
      })
      .returning();
    return toRecord(row!);
  }
}

function toRecord(row: typeof adminUsers.$inferSelect): AdminUserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    role: row.role,
    isActive: row.isActive,
  };
}
