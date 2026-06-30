import { describe, expect, it } from 'vitest';
import {
  formatAmountForDisplay,
  formatAssetAmount,
  formatDate,
  formatDateTime,
  statusLabel,
  statusTone,
  truncateMiddle,
} from '../src/lib/format';

describe('formatAmountForDisplay', () => {
  it('trims trailing zeros from a 7-scale amount', () => {
    expect(formatAmountForDisplay('150.0000000')).toBe('150');
    expect(formatAmountForDisplay('150.5000000')).toBe('150.5');
    expect(formatAmountForDisplay('0.0000001')).toBe('0.0000001');
  });

  it('leaves integer strings untouched', () => {
    expect(formatAmountForDisplay('42')).toBe('42');
  });
});

describe('formatAssetAmount', () => {
  it('joins amount and asset code', () => {
    expect(formatAssetAmount('150.0000000', 'XLM')).toBe('150 XLM');
  });
});

describe('truncateMiddle', () => {
  it('returns short values unchanged', () => {
    expect(truncateMiddle('GSHORT')).toBe('GSHORT');
  });

  it('truncates long values in the middle', () => {
    const key = 'GBPAYTENANT0000000000000000000000000000000000000000WXYZ';
    const result = truncateMiddle(key, 6, 6);
    expect(result.startsWith('GBPAYT')).toBe(true);
    expect(result.endsWith('00WXYZ')).toBe(true);
    expect(result).toContain('…');
  });
});

describe('formatDate / formatDateTime', () => {
  it('formats a due date to YYYY-MM-DD', () => {
    expect(formatDate('2026-07-10')).toBe('2026-07-10');
    expect(formatDate('2026-07-10T12:00:00Z')).toBe('2026-07-10');
    expect(formatDate(null)).toBe('—');
  });

  it('formats datetimes and falls back on bad input', () => {
    expect(formatDateTime('2026-06-29T12:34:56Z')).toContain('2026-06-29');
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
    expect(formatDateTime(null)).toBe('—');
  });
});

describe('status helpers', () => {
  it('maps statuses to a label and tone', () => {
    expect(statusLabel('PAID')).toBe('Pago');
    expect(statusTone('PAID')).toBe('success');
    expect(statusTone('ACTIVE')).toBe('pending');
    expect(statusTone('EXPIRED')).toBe('danger');
    expect(statusTone('CREATED')).toBe('neutral');
  });
});
