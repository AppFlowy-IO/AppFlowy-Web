import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabaseCell, YDatabaseField, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

export type CellFieldTypeContext = {
  storedType: FieldType;
  targetType: FieldType;
};

function parseFieldType(value: unknown): FieldType | undefined {
  const fieldType = Number(value);

  if (!Number.isInteger(fieldType) || FieldType[fieldType] === undefined) {
    return undefined;
  }

  return fieldType as FieldType;
}

/**
 * Returns the type that describes the cell's raw data encoding.
 *
 * `fallbackType` mirrors Desktop's behavior for old cells that do not contain
 * field_type: the reader treats them as native to the field being read.
 */
export function getStoredCellFieldType(cell: YDatabaseCell, fallbackType: FieldType = FieldType.RichText): FieldType {
  return (
    parseFieldType(cell.get(YjsDatabaseKey.source_field_type)) ??
    parseFieldType(cell.get(YjsDatabaseKey.field_type)) ??
    fallbackType
  );
}

/**
 * A cell's field_type describes the format of its raw data. The field's type
 * describes how that data should currently be presented and edited.
 *
 * Older Web clients overwrote cell.field_type during a field switch and kept
 * the actual storage type in source_field_type. Prefer that legacy marker when
 * present so those cells remain readable while new writes use Desktop's model.
 */
export function getCellFieldTypeContext(cell: YDatabaseCell, field?: YDatabaseField): CellFieldTypeContext {
  const cellType = parseFieldType(cell.get(YjsDatabaseKey.field_type));
  const targetType = parseFieldType(field?.get(YjsDatabaseKey.type)) ?? cellType ?? FieldType.RichText;
  const storedType = getStoredCellFieldType(cell, targetType);

  return { storedType, targetType };
}

/** Mark newly written data as native to the current field type. */
export function setCellStoredType(cell: YDatabaseCell, fieldType: FieldType): void {
  cell.set(YjsDatabaseKey.field_type, fieldType);
  cell.delete(YjsDatabaseKey.source_field_type);
}

/**
 * Convert an older Web cell to the canonical Desktop representation without
 * touching its raw data. Invalid legacy metadata is left intact rather than
 * guessing at the data format.
 */
export function normalizeLegacyCellFieldType(cell: YDatabaseCell): boolean {
  const sourceType = parseFieldType(cell.get(YjsDatabaseKey.source_field_type));

  if (sourceType !== undefined) {
    cell.set(YjsDatabaseKey.field_type, sourceType);
    cell.delete(YjsDatabaseKey.source_field_type);
    return true;
  }

  const rawFieldType = cell.get(YjsDatabaseKey.field_type);
  const fieldType = parseFieldType(rawFieldType);

  // Older Web writers stored this enum as a Yjs string. Desktop reads it as
  // i64, so canonicalize the representation even when no legacy source marker
  // is present.
  if (fieldType === undefined || typeof rawFieldType !== 'string') return false;

  cell.set(YjsDatabaseKey.field_type, fieldType);
  return true;
}

/** Normalize every cell in a row without changing any cell payload. */
export function normalizeLegacyRowCellFieldTypes(rowDoc: YDoc): boolean {
  const root = rowDoc.getMap(YjsEditorKey.data_section);
  const row = root.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;
  const cells = row?.get(YjsDatabaseKey.cells);

  if (!cells) return false;

  let changed = false;

  rowDoc.transact(() => {
    cells.forEach((cell) => {
      changed = normalizeLegacyCellFieldType(cell as YDatabaseCell) || changed;
    });
  });

  return changed;
}

const normalizedRowDocs = new WeakSet<YDoc>();

/**
 * Keep a loaded row canonical while older Web clients may still sync the
 * retired source_field_type representation during the rollout.
 */
export function installLegacyCellFieldTypeNormalizer(rowDoc: YDoc): void {
  if (normalizedRowDocs.has(rowDoc)) return;
  normalizedRowDocs.add(rowDoc);

  const root = rowDoc.getMap(YjsEditorKey.data_section);
  let normalizing = false;
  const normalize = (events?: Y.YEvent[]) => {
    const metadataChanged = events?.some(
      (event) =>
        event.path.length < 3 ||
        event.keys.has(YjsDatabaseKey.field_type) ||
        event.keys.has(YjsDatabaseKey.source_field_type)
    );

    if (events && !metadataChanged) return;
    if (normalizing) return;

    normalizing = true;
    try {
      normalizeLegacyRowCellFieldTypes(rowDoc);
    } finally {
      normalizing = false;
    }
  };

  root.observeDeep(normalize);
  normalize();
}
