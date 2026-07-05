import { describe, expect, it } from 'vitest';
import {
  asContractError,
  ContractError,
  CONTRACT_ERROR_CODES,
  parseContractErrorCode,
} from '../src/stellar/contract-error';

const HOST_ERROR = `HostError: Error(Contract, #6)
Event log (newest first):
0: [Diagnostic Event] topics:[error, Error(Contract, #6)], data:"escalating"`;

describe('parseContractErrorCode', () => {
  it('extracts the code from a raw Soroban HostError message', () => {
    expect(parseContractErrorCode(HOST_ERROR)).toBe(CONTRACT_ERROR_CODES.OrderNotActive);
  });

  it('extracts the code from an Error instance', () => {
    expect(parseContractErrorCode(new Error(HOST_ERROR))).toBe(6);
  });

  it('extracts the code from an object carrying a message', () => {
    expect(parseContractErrorCode({ message: 'Error(Contract, #8)' })).toBe(
      CONTRACT_ERROR_CODES.AmountMismatch,
    );
  });

  it('returns null for unrelated errors', () => {
    expect(parseContractErrorCode(new Error('network unreachable'))).toBeNull();
    expect(parseContractErrorCode('Bad union switch: 4')).toBeNull();
    expect(parseContractErrorCode(undefined)).toBeNull();
  });
});

describe('asContractError', () => {
  it('wraps a contract failure into a typed ContractError with the code', () => {
    const wrapped = asContractError(new Error(HOST_ERROR));
    expect(wrapped).toBeInstanceOf(ContractError);
    expect((wrapped as ContractError).code).toBe(6);
  });

  it('passes non-contract errors through unchanged', () => {
    const original = new Error('wallet declined');
    expect(asContractError(original)).toBe(original);
  });
});
