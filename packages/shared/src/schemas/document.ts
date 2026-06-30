import { z } from 'zod';

/**
 * Brazilian document validators (CPF / CNPJ) with check-digit verification, plus a
 * permissive `OTHER` type for non-Brazilian identifiers. See spec 05-tenant-onboarding §4.
 */

export const DOCUMENT_TYPES = ['CNPJ', 'CPF', 'OTHER'] as const;
export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

/** Strip everything that is not a digit. */
function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function isValidCpf(input: string): boolean {
  const cpf = onlyDigits(input);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) {
    return false;
  }

  const digits = cpf.split('').map(Number);
  for (let length = 9; length <= 10; length += 1) {
    let sum = 0;
    for (let i = 0; i < length; i += 1) {
      sum += digits[i]! * (length + 1 - i);
    }
    const remainder = ((sum * 10) % 11) % 10;
    if (remainder !== digits[length]) {
      return false;
    }
  }
  return true;
}

export function isValidCnpj(input: string): boolean {
  const cnpj = onlyDigits(input);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) {
    return false;
  }

  const digits = cnpj.split('').map(Number);
  const weights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (let length = 12; length <= 13; length += 1) {
    let sum = 0;
    const slice = weights.slice(weights.length - length);
    for (let i = 0; i < length; i += 1) {
      sum += digits[i]! * slice[i]!;
    }
    const remainder = sum % 11;
    const checkDigit = remainder < 2 ? 0 : 11 - remainder;
    if (checkDigit !== digits[length]) {
      return false;
    }
  }
  return true;
}

/**
 * Validate a document number against its declared type. `OTHER` only requires a
 * non-empty trimmed value.
 */
export function isValidDocument(type: DocumentType, number: string): boolean {
  switch (type) {
    case 'CPF':
      return isValidCpf(number);
    case 'CNPJ':
      return isValidCnpj(number);
    case 'OTHER':
      return number.trim().length > 0;
  }
}

/**
 * `Document` value object: `{ type, number }` with check-digit validation for CPF/CNPJ.
 * Emits the `INVALID_DOCUMENT` error code (spec 05 §7) when invalid.
 */
export const DocumentSchema = z
  .object({
    type: DocumentTypeSchema,
    number: z.string().min(1),
  })
  .refine((doc) => isValidDocument(doc.type, doc.number), {
    message: 'INVALID_DOCUMENT',
    path: ['number'],
  });

export type Document = z.infer<typeof DocumentSchema>;
