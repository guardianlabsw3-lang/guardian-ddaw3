/**
 * `@payorder/api` — Backend core. Phase 2 ships the framework-free domain, the application
 * use cases (Tenant + CreatePaymentOrder), and the PostgreSQL/Drizzle persistence layer
 * (TASK-010..015). Phase 3 adds the Soroban contract adapter, the on-chain registration /
 * sync / expiration use cases and the BullMQ queue plumbing (TASK-016..017). HTTP interfaces
 * (NestJS) land in later phases.
 */
export * from './domain/index.js';
export * from './application/index.js';
export * from './infrastructure/config/index.js';
export * from './infrastructure/persistence/index.js';
export * from './infrastructure/adapters/index.js';
export * from './infrastructure/observability/index.js';
export * from './infrastructure/stellar/index.js';
export * from './infrastructure/queue/index.js';
