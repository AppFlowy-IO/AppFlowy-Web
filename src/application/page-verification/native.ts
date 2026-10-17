import { nanoid } from 'nanoid';
import * as Y from 'yjs';

import { DEFAULT_FIELD_WRAP } from '@/application/database-yjs/const';
import { FieldType, FieldVisibility } from '@/application/database-yjs/database.type';
import { YDatabase, YDatabaseField, YDatabaseFieldTypeOption, YMapFieldTypeOption, YjsDatabaseKey } from '@/application/types';

export function isVerificationField(field: YDatabaseField | null | undefined): boolean {
  return Number(field?.get(YjsDatabaseKey.type)) === FieldType.Verification;
}

export function getVerificationPropertyId(field: YDatabaseField | undefined): string {
  const id = field?.get(YjsDatabaseKey.type_option)?.get(String(FieldType.Verification))?.get(YjsDatabaseKey.property_id);

  return typeof id === 'string' ? id : '';
}

export function getVerificationSourceType(field: YDatabaseField): FieldType {
  const value = field.get(YjsDatabaseKey.type_option)?.get(String(FieldType.Verification))?.get(YjsDatabaseKey.previous_field_type);
  const type = Number(value);

  return value !== undefined && Number.isInteger(type) && FieldType[type] !== undefined && type !== FieldType.Verification
    ? type as FieldType
    : FieldType.RichText;
}

/** Ambiguous remote schemas are never resolved by guessing a property binding. */
export function findVerificationField(database: YDatabase | undefined): YDatabaseField | undefined {
  const fields = Array.from(database?.get(YjsDatabaseKey.fields)?.values() ?? []).filter(isVerificationField);

  return fields.length === 1 ? fields[0] : undefined;
}

export function ensureVerificationFieldAvailable(database: YDatabase, exceptId?: string): void {
  database.get(YjsDatabaseKey.fields)?.forEach((field, id) => {
    if (id !== exceptId && isVerificationField(field)) throw new Error('A Verification property already exists');
  });
}

export type VerificationFieldGuard = {
  /** Recheck the authenticated editor after asynchronous preparation. */
  assertEditable?: () => void;
  expectedFieldType?: FieldType;
  expectedVerificationPropertyId?: string;
  verificationPropertyId?: string;
};

/** Checked again in the synchronous Yjs mutation after every Cloud or row-load await. */
export function assertFieldMutation(field: YDatabaseField | undefined, guard: VerificationFieldGuard = {}): void {
  guard.assertEditable?.();
  if (!field) throw new Error('Field not found');
  const type = Number(field.get(YjsDatabaseKey.type));

  if (guard.expectedFieldType !== undefined && type !== guard.expectedFieldType) {
    throw new Error('Field type changed while preparing the conversion');
  }

  if (isVerificationField(field) && (
    guard.expectedFieldType !== FieldType.Verification ||
    guard.expectedVerificationPropertyId === undefined ||
    guard.expectedVerificationPropertyId !== getVerificationPropertyId(field)
  )) throw new Error('Verification property changed; reopen the property editor');
}

/** Bind only metadata. Existing cell payloads and all other type options remain untouched. */
export function bindVerificationField(database: YDatabase, field: YDatabaseField, propertyId: string): void {
  if (!propertyId) throw new Error('Verification requires a Cloud property generation');
  if (field.get(YjsDatabaseKey.is_primary)) throw new Error('The primary property cannot become Verification');
  ensureVerificationFieldAvailable(database, field.get(YjsDatabaseKey.id));
  let options = field.get(YjsDatabaseKey.type_option);

  if (!options) {
    options = new Y.Map() as YDatabaseFieldTypeOption;
    field.set(YjsDatabaseKey.type_option, options);
  }

  let option = options.get(String(FieldType.Verification));

  if (!option) {
    option = new Y.Map() as YMapFieldTypeOption;
    options.set(String(FieldType.Verification), option);
  }

  if (!isVerificationField(field)) option.set(YjsDatabaseKey.previous_field_type, Number(field.get(YjsDatabaseKey.type)));
  option.set(YjsDatabaseKey.property_id, propertyId);
  field.set(YjsDatabaseKey.type, FieldType.Verification);
}

/** Local atomic uniqueness; concurrent remote schemas are rejected by the reader above. */
export function createNativeVerificationField(database: YDatabase, propertyId: string): string {
  if (!propertyId) throw new Error('Verification requires a Cloud property generation');
  const fieldId = nanoid(6);

  database.doc!.transact(() => {
    ensureVerificationFieldAvailable(database);
    const fields = database.get(YjsDatabaseKey.fields);
    const field = new Y.Map() as YDatabaseField;
    const now = String(Math.floor(Date.now() / 1000));

    field.set(YjsDatabaseKey.id, fieldId);
    field.set(YjsDatabaseKey.name, 'Verification');
    field.set(YjsDatabaseKey.type, FieldType.RichText);
    field.set(YjsDatabaseKey.is_primary, false);
    field.set(YjsDatabaseKey.created_at, now);
    field.set(YjsDatabaseKey.last_modified, now);
    fields.set(fieldId, field);
    bindVerificationField(database, field, propertyId);
    database.get(YjsDatabaseKey.views)?.forEach((view) => {
      view.get(YjsDatabaseKey.field_orders)?.push([{ id: fieldId }]);
      const setting = new Y.Map();

      setting.set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysShown);
      setting.set(YjsDatabaseKey.wrap, DEFAULT_FIELD_WRAP);
      view.get(YjsDatabaseKey.field_settings)?.set(fieldId, setting);
    });
  }, 'verification.create');
  return fieldId;
}

export function deleteNativeVerificationField(database: YDatabase, fieldId: string, propertyId: string): void {
  database.doc!.transact(() => {
    const fields = database.get(YjsDatabaseKey.fields);

    assertFieldMutation(fields.get(fieldId), {
      expectedFieldType: FieldType.Verification,
      expectedVerificationPropertyId: propertyId,
    });
    fields.delete(fieldId);
    database.get(YjsDatabaseKey.views)?.forEach((view) => {
      const orders = view.get(YjsDatabaseKey.field_orders);
      const index = orders?.toArray().findIndex((order) => order.id === fieldId);

      if (index !== undefined && index >= 0) orders.delete(index);
      view.get(YjsDatabaseKey.field_settings)?.delete(fieldId);
      // Query leaves retain their field type, so deleted fields cannot match new fields.
      for (const values of [view.get(YjsDatabaseKey.filters), view.get(YjsDatabaseKey.sorts)]) {

        for (let i = (values?.length ?? 0) - 1; i >= 0; i--) {
          if (values.get(i).get(YjsDatabaseKey.field_id) === fieldId) values.delete(i);
        }
      }
    });
  }, 'verification.delete');
}
