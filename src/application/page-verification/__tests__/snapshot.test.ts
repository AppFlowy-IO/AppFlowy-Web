import { FieldType } from '@/application/database-yjs/database.type';
import {
  isExternalDatabaseField, readExternalFieldValue, readVerificationFieldSnapshot, registerExternalDatabaseFields,
} from '@/application/database-yjs/external-fields';
import { createFields } from '@/application/database-yjs/fields/formula/__tests__/fixture';
import { YjsDatabaseKey } from '@/application/types';

import { verificationFieldSnapshot, verificationSnapshotText } from '../snapshot';
import { PageVerification } from '../types';

const data: PageVerification = {
  target_id: 'row', database_id: 'database', property: { id: 'generation', database_id: 'database' },
  status: 'verified', eligible: true, can_edit: false,
  verification: { id: 'claim', verified_by: { uid: 1, name: 'Annie' }, verified_at: '2026-10-01T00:00:00Z', expires_at: '2027-01-01T00:00:00.000123Z' },
};

function fixture() {
  const fields = createFields([{ id: 'field', name: 'Verification', type: FieldType.Verification, typeOption: { property_id: 'generation' } }]);
  const field = fields.get('field')!;

  return { fields, field };
}

it('accepts an authorized matching generation, retaining exact UTC microseconds', () => {
  const { field } = fixture();
  const snapshot = verificationFieldSnapshot(field, 'database', 'generation', data);

  expect(snapshot).toEqual({ status: 'verified', expiresAtMicros: 1798761600000123n });
  expect(verificationSnapshotText(snapshot)).toBe('Verified');
  // Eligibility controls new claims, not reading an already authorized claim.
  expect(verificationFieldSnapshot(field, 'database', 'generation', { ...data, eligible: false })).toEqual(snapshot);
  expect(verificationFieldSnapshot(field, 'database', 'generation', { ...data, verification: null, status: 'unverified' })).toEqual({ status: 'unverified', expiresAtMicros: null });
  expect(verificationSnapshotText(undefined)).toBeUndefined();
});

it.each([
  undefined,
  { ...data, property: null },
  { ...data, property: { id: 'old-generation', database_id: 'database' } },
  { ...data, database_id: 'another-database' },
  { ...data, verification: { ...data.verification!, expires_at: 'invalid' } },
])('treats missing, revoked and mismatched claims as unknown: %j', (state) => {
  const { field } = fixture();

  expect(verificationFieldSnapshot(field, 'database', 'generation', state)).toBeUndefined();
});

it('revokes reads synchronously on native field rebinding or conversion out', () => {
  const { field } = fixture();

  field.get(YjsDatabaseKey.type_option).get('20').set(YjsDatabaseKey.property_id, 'replacement');
  expect(verificationFieldSnapshot(field, 'database', 'generation', data)).toBeUndefined();
  field.set(YjsDatabaseKey.type, FieldType.RichText);
  expect(verificationFieldSnapshot(field, 'database', 'generation', data)).toBeUndefined();
});

it('keeps linked-view readers alive until their final owner closes and never falls back to source cells', () => {
  const { fields, field } = fixture();
  const reader = {
    field,
    readValue: () => 'Verified',
    readVerificationSnapshot: () => verificationFieldSnapshot(field, 'database', 'generation', data),
  };
  const stopFirst = registerExternalDatabaseFields(fields, [reader]);
  const stopSecond = registerExternalDatabaseFields(fields, [reader]);
  const before = fields.toJSON();

  stopFirst();
  expect(readExternalFieldValue(field, 'row')).toBe('Verified');
  expect(readVerificationFieldSnapshot(field, 'row')?.status).toBe('verified');
  stopSecond();
  expect(isExternalDatabaseField(field)).toBe(true);
  expect(readExternalFieldValue(field, 'row')).toBeUndefined();
  expect(readVerificationFieldSnapshot(field, 'row')).toBeUndefined();
  expect(fields.toJSON()).toEqual(before);
});
