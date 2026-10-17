import { FieldType } from '@/application/database-yjs/database.type';
import { getTypeOptions } from '@/application/database-yjs/fields/type_option';
import { VerificationSnapshot, verificationTimestampMicros } from '@/application/database-yjs/fields/verification';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';

import { PageVerification } from './types';

/** A claim belongs to a Cloud property generation, never merely to a field ID. */
export function verificationFieldSnapshot(
  field: YDatabaseField,
  databaseId: string,
  propertyId: string,
  data: PageVerification | undefined
): VerificationSnapshot | undefined {
  const options = getTypeOptions(field)?.toJSON() as { property_id?: string } | undefined;

  if (
    Number(field.get(YjsDatabaseKey.type)) !== FieldType.Verification ||
    options?.property_id !== propertyId ||
    data?.database_id !== databaseId ||
    data.property?.database_id !== databaseId ||
    data.property.id !== propertyId
  ) return undefined;

  if (!data.verification) return { status: 'unverified', expiresAtMicros: null };
  const expiry = data.verification.expires_at;
  const expiresAtMicros = expiry === null ? null : verificationTimestampMicros(expiry);

  if (expiresAtMicros === undefined || data.status === 'unverified') return undefined;
  return { status: data.status, expiresAtMicros };
}

export function verificationSnapshotText(snapshot: VerificationSnapshot | undefined): string | undefined {
  if (!snapshot) return undefined;
  return snapshot.status === 'verified' ? 'Verified' : snapshot.status === 'expired' ? 'Expired' : '';
}
