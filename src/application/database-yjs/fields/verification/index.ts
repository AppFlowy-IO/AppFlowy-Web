import type { Filter } from '@/application/database-yjs/database.type';
import { SortCondition } from '@/application/database-yjs/database.type';

export enum VerificationFilterCondition {
  Is = 0,
  IsNot = 1,
  IsEmpty = 2,
  IsNotEmpty = 3,
}

export enum VerificationFilterStatus {
  Unverified = 0,
  Verified = 1,
  Expired = 2,
}

/** Only the authenticated Cloud reader may supply this value. Missing is unknown. */
export interface VerificationSnapshot {
  status: 'unverified' | 'verified' | 'expired';
  expiresAtMicros: bigint | null;
}

export interface VerificationPredicate {
  condition: VerificationFilterCondition;
  status: VerificationFilterStatus;
  expiresAfterMicros: bigint | null;
  expiresBeforeMicros: bigint | null;
}

export type VerificationFilter = Filter & VerificationPredicate;

const conditionNames = ['Is', 'IsNot', 'IsEmpty', 'IsNotEmpty'] as const;
const statusNames = ['Unverified', 'Verified', 'Expired'] as const;
const statusRanks = { unverified: 0, verified: 1, expired: 2 } as const;
const minMicros = -(2n ** 63n);
const maxMicros = 2n ** 63n - 1n;

function readMicros(value: unknown, exact: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || typeof exact !== 'string' || !/^-?\d+$/.test(exact)) {
    throw new Error('Invalid Verification microsecond bound');
  }

  const micros = BigInt(exact);

  if (micros < minMicros || micros > maxMicros) throw new Error('Verification bound is outside i64');
  return micros;
}

/** Desktop's outer condition is authoritative. Invalid JSON resets the entire payload. */
export function parseVerificationFilter(condition: number, content: string): VerificationPredicate {
  const result: VerificationPredicate = {
    condition: conditionNames[condition] ? condition : VerificationFilterCondition.Is,
    status: VerificationFilterStatus.Unverified,
    expiresAfterMicros: null,
    expiresBeforeMicros: null,
  };

  try {
    const data = JSON.parse(content);
    // Preserve numeric tokens before JSON.parse rounds i64 values. Quoted strings
    // are skipped, and the original parse distinguishes numbers from strings.
    const exact = JSON.parse(
      content.replace(/"(?:\\.|[^"\\])*"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, (token, number) =>
        number === undefined ? token : JSON.stringify(number)
      )
    );

    if (!conditionNames.includes(data?.condition) || !statusNames.includes(data?.status)) return result;
    const lower = readMicros(data.expires_after_micros, exact.expires_after_micros);
    const upper = readMicros(data.expires_before_micros, exact.expires_before_micros);

    return {
      ...result,
      status: statusNames.indexOf(data.status),
      expiresAfterMicros: lower,
      expiresBeforeMicros: upper,
    };
  } catch {
    return result;
  }
}

/** Emit numeric i64 tokens, not JSON strings or rounded JavaScript numbers. */
export function serializeVerificationFilter(filter: VerificationPredicate): string {
  const lower = filter.expiresAfterMicros?.toString() ?? 'null';
  const upper = filter.expiresBeforeMicros?.toString() ?? 'null';

  return `{"condition":"${conditionNames[filter.condition]}","status":"${
    statusNames[filter.status]
  }","expires_after_micros":${lower},"expires_before_micros":${upper}}`;
}

/** RFC3339 Cloud expirations retain their sub-millisecond precision and timezone. */
export function verificationTimestampMicros(value: string): bigint | undefined {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);

  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match[1].split(/[-T:]/).map(Number);
  const calendar = new Date(0);

  calendar.setUTCFullYear(year, month - 1, day);
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return undefined;
  const seconds = Date.parse(`${match[1]}${match[3]}`);

  if (!Number.isFinite(seconds)) return undefined;
  return BigInt(seconds) * 1000n + BigInt((match[2] ?? '').padEnd(6, '0').slice(0, 6));
}

export function matchesVerificationFilter(
  value: VerificationSnapshot | undefined,
  filter: VerificationPredicate
): boolean {
  if (!value) return false;
  const status = statusRanks[value.status];
  const matches =
    filter.condition === VerificationFilterCondition.Is
      ? status === filter.status
      : filter.condition === VerificationFilterCondition.IsNot
      ? status !== filter.status
      : filter.condition === VerificationFilterCondition.IsEmpty
      ? status === VerificationFilterStatus.Unverified
      : status !== VerificationFilterStatus.Unverified;

  return (
    matches &&
    (filter.expiresAfterMicros === null ||
      (value.expiresAtMicros !== null && value.expiresAtMicros >= filter.expiresAfterMicros)) &&
    (filter.expiresBeforeMicros === null ||
      (value.expiresAtMicros !== null && value.expiresAtMicros <= filter.expiresBeforeMicros))
  );
}

/** Unknown sorts last in either direction; only known status/expiry order reverses. */
export function compareVerificationSnapshots(
  left: VerificationSnapshot | undefined,
  right: VerificationSnapshot | undefined,
  direction: SortCondition
): number {
  if (!left || !right) return left ? -1 : right ? 1 : 0;
  const status = statusRanks[left.status] - statusRanks[right.status];
  const a = left.expiresAtMicros;
  const b = right.expiresAtMicros;
  const expiry = a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1;
  const order = status || expiry;

  return direction === SortCondition.Descending ? -order : order;
}
