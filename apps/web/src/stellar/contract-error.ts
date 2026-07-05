/**
 * Turns a Soroban `HostError` raised while simulating/submitting a contract call into a typed
 * error carrying the numeric contract error code. This lets the UI show a clear, localized
 * message ("this charge is already paid…") instead of leaking the raw
 * `HostError: Error(Contract, #6) Event log …` string to the payer.
 *
 * The names/codes mirror the `Error` enum in `contracts/payorder/src/lib.rs` exactly.
 */

export const CONTRACT_ERROR_CODES = {
  NotInitialized: 1,
  AlreadyInitialized: 2,
  Unauthorized: 3,
  OrderAlreadyExists: 4,
  OrderNotFound: 5,
  OrderNotActive: 6,
  OrderExpired: 7,
  AmountMismatch: 8,
  AssetMismatch: 9,
  InvalidAmount: 10,
} as const;

export type ContractErrorName = keyof typeof CONTRACT_ERROR_CODES;

/** A contract-level failure (`Error(Contract, #N)`) surfaced by simulation or submission. */
export class ContractError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'ContractError';
  }
}

// Matches the `Error(Contract, #6)` fragment the Soroban host embeds in the error message
// (produced by both `prepareTransaction`'s simulation and a failed submission).
const CONTRACT_ERROR_PATTERN = /Error\(Contract,\s*#(\d+)\)/;

function extractMessage(err: unknown): string | null {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    const { message } = err as { message: unknown };
    if (typeof message === 'string') return message;
  }
  return null;
}

/** Extract the numeric contract error code from a raw Soroban error, or `null` if absent. */
export function parseContractErrorCode(err: unknown): number | null {
  const message = extractMessage(err);
  if (!message) return null;
  const match = CONTRACT_ERROR_PATTERN.exec(message);
  return match ? Number.parseInt(match[1] as string, 10) : null;
}

/**
 * Convert a raw Soroban error into a {@link ContractError} when it carries a contract error
 * code; otherwise returns the original error unchanged so unrelated failures (network, wallet)
 * keep their message.
 */
export function asContractError(err: unknown): unknown {
  const code = parseContractErrorCode(err);
  if (code === null) return err;
  return new ContractError(code, extractMessage(err) ?? `Error(Contract, #${code})`);
}
