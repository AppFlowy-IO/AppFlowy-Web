import { verificationTimestampMicros } from '@/application/database-yjs/fields/verification';

export type VerificationStatus = 'unverified' | 'verified' | 'expired';

export interface VerificationProperty {
  id: string;
  database_id: string;
}

export interface VerificationRecord {
  id: string;
  verified_by: { uid: number; name: string };
  verified_at: string;
  expires_at: string | null;
}

export interface PageVerification {
  target_id: string;
  database_id: string | null;
  property: VerificationProperty | null;
  verification: VerificationRecord | null;
  status: VerificationStatus;
  can_edit: boolean;
  eligible: boolean;
}

export type VerificationExpiration =
  | { kind: 'thirty_days' | 'ninety_days' | 'indefinitely' }
  | { kind: 'custom'; expires_at: string };

export interface VerificationPropertyState {
  views?: Record<string, VerificationViewSettings>;
  property: VerificationProperty | null;
  can_edit: boolean;
  eligible: boolean;
}

/** Status never depends on a document or cell modification timestamp. */
export function verificationStatus(record: VerificationRecord | null | undefined, now = Date.now()): VerificationStatus {
  if (!record) return 'unverified';
  const expires = record.expires_at ? verificationTimestampMicros(record.expires_at) : undefined;

  return expires !== undefined && expires <= BigInt(Math.trunc(now)) * 1000n ? 'expired' : 'verified';
}

/** Text projection shared by formulas and Filled/Empty calculations. */
export function verificationCellValue(record: VerificationRecord | null | undefined, now = Date.now()): string {
  const status = verificationStatus(record, now);

  return status === 'verified' ? 'Verified' : status === 'expired' ? 'Expired' : '';
}

export function verificationTooltip(record: VerificationRecord, locale?: string, now = Date.now()): string {
  const date = (value: string) =>
    new Date(value).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  const prefix = verificationStatus(record, now) === 'expired' ? 'Expired — ' : '';
  const period = record.expires_at ? `to ${date(record.expires_at)}` : 'indefinitely';

  return `${prefix}Verified by ${record.verified_by.name || 'Unknown user'} from ${date(record.verified_at)} ${period}`;
}

export interface VerificationViewSettings {
  grouping?: VerificationGroupSettings | null;
  calculation?:
    | 'count'
    | 'count_empty'
    | 'count_non_empty'
    | 'count_unique'
    | 'percent_empty'
    | 'percent_not_empty'
    | null;

}

export interface VerificationGroupSettings {
  order?: VerificationStatus[];
  hidden?: VerificationStatus[];
  collapsed?: VerificationStatus[];
  hide_empty?: boolean;
}
