import { FieldType } from '@/application/database-yjs/database.type';
import { decodeCellForSort, decodeCellToText } from '@/application/database-yjs/decode';
import { User, YDatabaseField, YDatabaseRow, YjsDatabaseKey } from '@/application/types';

import { RowPageProperty } from './row-page-state';

/** Capture visible cells only. No relation expansion and no invented defaults for missing cells. */
export function snapshotRowProperties(
  row: YDatabaseRow | undefined,
  properties: { id: string; name: string; type: FieldType }[],
  getField: (id: string) => YDatabaseField | undefined,
  user?: User
): RowPageProperty[] {
  const cells = row?.get(YjsDatabaseKey.cells);

  return properties.map((property) => {
    const cell = cells?.get(property.id);
    const field = getField(property.id);
    let value: RowPageProperty['value'] = null;

    if (cell && field && cell.has(YjsDatabaseKey.data)) {
      const supported = [
        FieldType.RichText,
        FieldType.Number,
        FieldType.DateTime,
        FieldType.SingleSelect,
        FieldType.MultiSelect,
        FieldType.Checkbox,
        FieldType.URL,
        FieldType.Checklist,
        FieldType.Relation,
        FieldType.Summary,
        FieldType.Translate,
        FieldType.Time,
      ];

      if (supported.includes(property.type)) {
        const decoded =
          property.type === FieldType.Number || property.type === FieldType.Checkbox
            ? decodeCellForSort(cell, field, user)
            : decodeCellToText(cell, field, user);

        value = decoded === '' ? null : decoded;
      }
    }

    return { id: `property:${property.id}`, name: property.name, type: FieldType[property.type] ?? 'Unknown', value };
  });
}
