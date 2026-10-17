import { VerificationRecord, verificationStatus } from '../types';
import { SortCondition } from '@/application/database-yjs/database.type';
import { compareVerificationSnapshots, verificationTimestampMicros } from '@/application/database-yjs/fields/verification';

const compare = (a: VerificationRecord | null, b: VerificationRecord | null, at: number) => {
  const snapshot = (record: VerificationRecord | null) => ({
    status: verificationStatus(record, at),
    expiresAtMicros: record?.expires_at ? verificationTimestampMicros(record.expires_at)! : null,
  });
  return compareVerificationSnapshots(snapshot(a), snapshot(b), SortCondition.Ascending);
};

const now = Date.parse('2026-10-16T00:00:00Z');
const record = (expires_at: string | null): VerificationRecord => ({
  id: 'verification',
  verified_by: { uid: 1, name: 'Reviewer' },
  verified_at: '2026-10-01T00:00:00Z',
  expires_at,
});
const values: Record<string, VerificationRecord | null> = {
  nov14: record('2026-11-14T00:00:00Z'),
  nov15: record('2026-11-15T00:00:00Z'),
  oct23: record('2026-10-23T00:00:00Z'),
  indefinite: record(null),
  oct28: record('2026-10-28T00:00:00Z'),
  oct24: record('2026-10-24T00:00:00Z'),
  oct23Tie: record('2026-10-23T08:00:00+08:00'),
  blank: null,
};

it.each([
  ['descending', ['indefinite', 'nov15', 'nov14', 'oct28', 'oct24', 'oct23', 'oct23Tie', 'blank']],
  ['ascending', ['blank', 'oct23', 'oct23Tie', 'oct24', 'oct28', 'nov14', 'nov15', 'indefinite']],
] as const)('sorts the reported dates in %s order, retaining equal-date ties', (direction, expected) => {
  const rows = Object.keys(values);
  rows.sort((a, b) => compare(values[a], values[b], now) * (direction === 'descending' ? -1 : 1));
  expect(rows).toEqual(expected);
});

it('retains status groups and orders expired records by their original expiration', () => {
  const rows = [record('2026-10-15T00:00:00Z'), values.nov14, null, record('2026-10-14T00:00:00Z')];
  const ordered = [...rows].sort((a, b) => -compare(a, b, now));
  expect(ordered).toEqual([rows[0], rows[3], rows[1], rows[2]]);
});

it('treats indefinite records and blank records as stable ties', () => {
  expect(compare(record(null), record(null), now)).toBe(0);
  expect(compare(null, null, now)).toBe(0);
});

it('uses the current expiration after renewal rather than the verification timestamp', () => {
  const renewed = { ...values.oct23!, expires_at: '2027-01-14T00:00:00Z' };
  expect(compare(values.oct23, values.nov15, now)).toBeLessThan(0);
  expect(compare(renewed, values.nov15, now)).toBeGreaterThan(0);
});

it('evaluates all statuses at the supplied expiration boundary', () => {
  const atBoundary = record('2026-10-16T00:00:00Z');
  expect(compare(atBoundary, values.nov15, now - 1)).toBeLessThan(0);
  expect(compare(atBoundary, values.nov15, now)).toBeGreaterThan(0);
});
