import { z } from 'zod';
import {
  StellarNetworkSchema,
  isValidEd25519SecretSeed,
  type StellarNetwork,
} from '@payorder/shared';

/**
 * Environment loading and validation (TASK-011). The application must **not** boot with an
 * invalid environment, and the MVP is locked to Stellar **Testnet** — any attempt to run
 * against Mainnet (by network name or by network passphrase) is rejected (spec 02 §2,
 * RNF-12). Validation is centralized here so every entrypoint (api/worker) shares it.
 */

/** Canonical Testnet network passphrase (spec 12 §env). */
export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

/** Mainnet passphrase — explicitly rejected so Testnet can never be bypassed. */
export const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

const BooleanFromString = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const PortSchema = z.coerce.number().int().min(1).max(65535);

/**
 * Comma-separated origin list → string[]. Empty/whitespace entries are dropped.
 */
const CorsOriginsSchema = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  );

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: PortSchema.default(3000),
    APP_BASE_URL: z.string().url(),
    PUBLIC_WEB_URL: z.string().url(),

    DATABASE_URL: z
      .string()
      .min(1)
      .refine((v) => /^postgres(ql)?:\/\//.test(v), {
        message: 'DATABASE_URL must be a postgres connection string',
      }),
    REDIS_URL: z
      .string()
      .min(1)
      .refine((v) => /^rediss?:\/\//.test(v), {
        message: 'REDIS_URL must be a redis connection string',
      }),

    JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 characters'),
    WEBHOOK_SIGNING_SECRET: z
      .string()
      .min(8, 'WEBHOOK_SIGNING_SECRET must be at least 8 characters'),
    CORS_ORIGINS: CorsOriginsSchema,

    // Stellar — Testnet only.
    STELLAR_NETWORK: StellarNetworkSchema.default('TESTNET'),
    STELLAR_NETWORK_PASSPHRASE: z.string().default(TESTNET_PASSPHRASE),
    STELLAR_HORIZON_URL: z.string().url().default('https://horizon-testnet.stellar.org'),
    STELLAR_SOROBAN_RPC_URL: z.string().url().default('https://soroban-testnet.stellar.org'),
    STELLAR_FRIENDBOT_URL: z.string().url().default('https://friendbot.stellar.org'),

    SOROBAN_CONTRACT_ID: z.string().trim().min(1).optional(),
    SOROBAN_ADMIN_SECRET: z
      .string()
      .trim()
      .min(1)
      .refine(isValidEd25519SecretSeed, {
        message:
          'SOROBAN_ADMIN_SECRET must be a valid Stellar ed25519 secret seed ("S...", 56 chars) — not a public key ("G...")',
      })
      .optional(),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    REGISTER_ON_CHAIN_SYNC: BooleanFromString.default('false'),
  })
  .superRefine((env, ctx) => {
    // Defense in depth: reject a Mainnet passphrase even though the network enum is locked.
    if (env.STELLAR_NETWORK_PASSPHRASE !== TESTNET_PASSPHRASE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STELLAR_NETWORK_PASSPHRASE'],
        message:
          env.STELLAR_NETWORK_PASSPHRASE === MAINNET_PASSPHRASE
            ? 'UNSUPPORTED_NETWORK: Mainnet passphrase is not allowed (Testnet only)'
            : 'STELLAR_NETWORK_PASSPHRASE must be the Testnet passphrase',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export interface AppConfig {
  readonly nodeEnv: Env['NODE_ENV'];
  readonly api: { readonly port: number; readonly baseUrl: string; readonly corsOrigins: string[] };
  readonly publicWebUrl: string;
  readonly database: { readonly url: string };
  readonly redis: { readonly url: string };
  readonly auth: { readonly jwtSecret: string };
  readonly webhooks: { readonly signingSecret: string };
  readonly stellar: {
    readonly network: StellarNetwork;
    readonly networkPassphrase: string;
    readonly horizonUrl: string;
    readonly sorobanRpcUrl: string;
    readonly friendbotUrl: string;
    readonly sorobanContractId: string | null;
    /** Admin secret seed (`S...`) authorizing `register_order`; null when unset (api). */
    readonly sorobanAdminSecret: string | null;
  };
  readonly logLevel: Env['LOG_LEVEL'];
  readonly registerOnChainSync: boolean;
}

export class EnvValidationError extends Error {
  readonly issues: { path: string; message: string }[];
  constructor(issues: { path: string; message: string }[]) {
    super(
      `Invalid environment configuration:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`,
    );
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/** Map the flat validated env into the structured, immutable application config. */
export function toAppConfig(env: Env): AppConfig {
  return {
    nodeEnv: env.NODE_ENV,
    api: { port: env.API_PORT, baseUrl: env.APP_BASE_URL, corsOrigins: env.CORS_ORIGINS },
    publicWebUrl: env.PUBLIC_WEB_URL,
    database: { url: env.DATABASE_URL },
    redis: { url: env.REDIS_URL },
    auth: { jwtSecret: env.JWT_SECRET },
    webhooks: { signingSecret: env.WEBHOOK_SIGNING_SECRET },
    stellar: {
      network: env.STELLAR_NETWORK,
      networkPassphrase: env.STELLAR_NETWORK_PASSPHRASE,
      horizonUrl: env.STELLAR_HORIZON_URL,
      sorobanRpcUrl: env.STELLAR_SOROBAN_RPC_URL,
      friendbotUrl: env.STELLAR_FRIENDBOT_URL,
      sorobanContractId: env.SOROBAN_CONTRACT_ID ?? null,
      sorobanAdminSecret: env.SOROBAN_ADMIN_SECRET ?? null,
    },
    logLevel: env.LOG_LEVEL,
    registerOnChainSync: env.REGISTER_ON_CHAIN_SYNC,
  };
}

/**
 * Parse and validate raw env (defaults to `process.env`). Throws `EnvValidationError`
 * aggregating every problem so misconfiguration fails fast and loudly at boot.
 */
export function loadConfig(raw: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    }));
    throw new EnvValidationError(issues);
  }
  return toAppConfig(result.data);
}
