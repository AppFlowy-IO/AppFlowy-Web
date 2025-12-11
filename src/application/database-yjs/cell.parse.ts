import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import {
  ChecklistCellData,
  SelectOption,
  generateOptionId,
  getDateCellStr,
  parseChecklistFlexible,
  parseSelectOptionTypeOptions,
  stringifyChecklist,
} from '@/application/database-yjs/fields';
import { parseCheckboxValue, parseTimeStringToMs } from '@/application/database-yjs/fields/text/utils';
import { User, YDatabaseCell, YDatabaseField, YjsDatabaseKey } from '@/application/types';

import { Cell, DateTimeCell, FileMediaCell, FileMediaCellData } from './cell.type';

export function parseYDatabaseCommonCellToCell(cell: YDatabaseCell): Cell {
  return {
    createdAt: Number(cell.get(YjsDatabaseKey.created_at)),
    lastModified: Number(cell.get(YjsDatabaseKey.last_modified)),
    fieldType: parseInt(cell.get(YjsDatabaseKey.field_type)) as FieldType,
    data: cell.get(YjsDatabaseKey.data),
  };
}

export function parseYDatabaseCellToCell(cell: YDatabaseCell, field?: YDatabaseField): Cell {
  const cellType = parseInt(cell.get(YjsDatabaseKey.field_type));
  const sourceType = Number(
    cell.get(YjsDatabaseKey.source_field_type) ?? cellType
  ) as FieldType;

  let value = parseYDatabaseCommonCellToCell(cell);

  if (sourceType !== cellType) {
    value.data = transformCellData(cell, sourceType, cellType, field);
  }

  if (cellType === FieldType.DateTime) {
    if (sourceType !== FieldType.DateTime) {
      value = {
        ...value,
        fieldType: FieldType.DateTime,
        // Default values for converted Date cells
        endTimestamp: undefined,
        includeTime: false,
        isRange: false,
        reminderId: undefined,
      } as DateTimeCell;
    } else {
      value = parseYDatabaseDateTimeCellToCell(cell);
    }
  }

  if (cellType === FieldType.FileMedia) {
    value = parseYDatabaseFileMediaCellToCell(cell);
  }

  if (cellType === FieldType.Relation) {
    value = parseYDatabaseRelationCellToCell(cell);
  }

  return value;
}

function transformCellData(
  cell: YDatabaseCell,
  sourceType: FieldType,
  targetType: FieldType,
  field?: YDatabaseField
): unknown {
  const data = cell.get(YjsDatabaseKey.data);

  if (data === undefined || data === null) return data;

  switch (targetType) {
    case FieldType.RichText:
      return stringifyFromSource(cell, field, sourceType);

    case FieldType.Checklist: {
      if (typeof data !== 'string') return '';
      if (sourceType === FieldType.RichText) {
        const parsed = parseChecklistFlexible(data);

        if (!parsed) return '';

        return stringifyChecklistStruct(parsed);
      }

      if (
        (sourceType === FieldType.SingleSelect || sourceType === FieldType.MultiSelect) &&
        field
      ) {
        const typeOption = parseSelectOptionTypeOptions(field);
        const options = typeOption?.options || [];
        const selectedIds = data.split(',');
        const checklistOptions: SelectOption[] = [];
        const checklistSelectedIds: string[] = [];

        options.forEach((opt) => {
          const newOpt = { ...opt, id: generateOptionId() };

          checklistOptions.push(newOpt);
          if (selectedIds.includes(opt.id)) {
            checklistSelectedIds.push(newOpt.id);
          }
        });

        return JSON.stringify({
          options: checklistOptions,
          selected_option_ids: checklistSelectedIds,
        });
      }

      return '';
    }

    case FieldType.SingleSelect:
    case FieldType.MultiSelect: {
      if (!field) return '';
      const typeOption = parseSelectOptionTypeOptions(field);
      const options = typeOption?.options || [];

      if (sourceType === FieldType.Checklist && typeof data === 'string') {
        const checklist = parseChecklistFlexible(data);

        if (!checklist) return '';
        const selectedIds: string[] = [];

        checklist.options?.forEach((opt) => {
          if (checklist.selectedOptionIds?.includes(opt.id)) {
            const match = options.find((o) => o.name === opt.name);

            if (match) selectedIds.push(match.id);
          }
        });
        return selectedIds.join(',');
      }

      if (sourceType === FieldType.RichText && typeof data === 'string') {
        const names = data.split(',').map((s) => s.trim());
        const ids = names
          .map((name) => options.find((o) => o.name === name)?.id)
          .filter(Boolean);

        return ids.join(',');
      }

      // Checkbox → SingleSelect/MultiSelect: map "Yes"/"No" to option IDs
      if (sourceType === FieldType.Checkbox && (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean')) {
        const isChecked = parseCheckboxValue(data);
        const targetName = isChecked ? 'Yes' : 'No';
        const matchingOption = options.find((o) => o.name === targetName);

        return matchingOption?.id || '';
      }

      return '';
    }

    case FieldType.Number:
      if (typeof data === 'string' || typeof data === 'number') {
        return String(data);
      }

      return '';

    case FieldType.Checkbox:
      if (sourceType === FieldType.RichText) {
        if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
          return parseCheckboxValue(data) ? 'Yes' : 'No';
        }

        return '';
      }

      // SingleSelect/MultiSelect → Checkbox: check if selected option name/id is "Yes"
      if (sourceType === FieldType.SingleSelect || sourceType === FieldType.MultiSelect) {
        if (typeof data === 'string' && data) {
          const selectedIds = data.split(',');
          // First, try to look up option names from field type_option (if still available)
          const typeOption = field ? parseSelectOptionTypeOptions(field) : null;
          const options = typeOption?.options || [];
          // Check if any selected option has name "Yes" (either by option lookup or direct ID match)
          const hasYes = selectedIds.some((id) => {
            const option = options.find((o) => o.id === id);

            // Check option name, or fallback to checking if ID itself is "Yes"
            // (for newly created options where id === name)
            return option?.name === 'Yes' || id === 'Yes';
          });

          return hasYes ? 'Yes' : 'No';
        }

        return 'No';
      }

      return '';

    case FieldType.URL:
      if (typeof data === 'string') return data.trim();
      return '';

    case FieldType.Time:
      if (typeof data === 'string') return parseTimeStringToMs(data) ?? '';
      if (typeof data === 'number') return String(data);
      return '';

    default:
      return data;
  }
}

export function parseYDatabaseDateTimeCellToCell(cell: YDatabaseCell): DateTimeCell {
  let data = cell.get(YjsDatabaseKey.data);

  if (typeof data !== 'string' && typeof data !== 'number') {
    data = '';
  } else {
    data = String(data);
  }

  return {
    ...parseYDatabaseCommonCellToCell(cell),
    data,
    fieldType: FieldType.DateTime,
    endTimestamp: cell.get(YjsDatabaseKey.end_timestamp),
    includeTime: cell.get(YjsDatabaseKey.include_time),
    isRange: cell.get(YjsDatabaseKey.is_range),
    reminderId: cell.get(YjsDatabaseKey.reminder_id),
  };
}

export function parseYDatabaseFileMediaCellToCell(cell: YDatabaseCell): FileMediaCell {
  const data = cell.get(YjsDatabaseKey.data) as Y.Array<string>;

  if (!data || !(data instanceof Y.Array<string>)) {
    return {
      ...parseYDatabaseCommonCellToCell(cell),
      data: [],
      fieldType: FieldType.FileMedia,
    } as FileMediaCell;
  }

  // Convert YArray<string> to FileMediaCellData
  const dataJson = data.toJSON().map((item: string) => JSON.parse(item)) as FileMediaCellData;

  return {
    ...parseYDatabaseCommonCellToCell(cell),
    data: dataJson,
    fieldType: FieldType.FileMedia,
  };
}

export function parseYDatabaseRelationCellToCell(cell: YDatabaseCell): Cell {
  const data = cell.get(YjsDatabaseKey.data) as Y.Array<string>;

  if (!data || !(data instanceof Y.Array<string>)) {
    return {
      ...parseYDatabaseCommonCellToCell(cell),
      fieldType: FieldType.Relation,
      data: null,
    };
  }

  return {
    ...parseYDatabaseCommonCellToCell(cell),
    fieldType: FieldType.Relation,
    data: data,
  };
}

export function getCellDataText(cell: YDatabaseCell, field: YDatabaseField, currentUser?: User): string {
  const type = parseInt(field.get(YjsDatabaseKey.type));
  const sourceType = Number(
    cell.get(YjsDatabaseKey.source_field_type) ?? cell.get(YjsDatabaseKey.field_type)
  ) as FieldType;

  switch (type) {
    case FieldType.SingleSelect:
    case FieldType.MultiSelect: {
      const data = cell.get(YjsDatabaseKey.data);
      const options = parseSelectOptionTypeOptions(field)?.options || [];

      if (typeof data === 'string') {
        // If the data came from a checklist, map checked items to option names
        const checklist = parseChecklistFlexible(data);

        if (checklist && sourceType === FieldType.Checklist) {
          const selectedNames = checklist.selectedOptionIds
            ?.map((id) => options.find((opt) => opt.id === id || opt.name === id)?.name)
            .filter(Boolean);

          if (selectedNames?.length) {
            return selectedNames.join(',');
          }
        }

        return (
          data
            .split(',')
            .map((item) => {
              const option = options?.find((option) => option?.id === item || option?.name === item);

              return option?.name || '';
            })
            .filter((item) => item)
            .join(',') || ''
        );
      }

      return '';
    }

    case FieldType.Checklist: {
      const cellData = cell.get(YjsDatabaseKey.data);

      if (typeof cellData === 'string') {
        const parsed = parseChecklistFlexible(cellData);

        if (!parsed) return '';
        return stringifyChecklist(parsed.options || [], parsed.selectedOptionIds || []);
      }

      return '';
    }

    case FieldType.Checkbox: {
      const data = cell.get(YjsDatabaseKey.data);

      if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
        const isChecked = parseCheckboxValue(data);

        return isChecked ? 'Yes' : 'No';
      }

      return '';
    }

    case FieldType.Time: {
      const data = cell.get(YjsDatabaseKey.data);

      if (data === undefined || data === null) return '';

      if (typeof data === 'number') {
        return String(data);
      }

      if (typeof data === 'string') {
        const parsed = parseTimeStringToMs(data);

        return parsed ?? '';
      }

      return '';
    }

    case FieldType.URL: {
      const data = cell.get(YjsDatabaseKey.data);

      if (typeof data === 'string' || typeof data === 'number') {
        return String(data).trim();
      }

      return '';
    }

    case FieldType.DateTime: {
      const dateCell = parseYDatabaseDateTimeCellToCell(cell);

      return getDateCellStr({ cell: dateCell, field, currentUser });
    }

    case FieldType.CreatedTime:
    case FieldType.LastEditedTime:
    case FieldType.Relation:
      return '';

    default: {
      const data = cell.get(YjsDatabaseKey.data);

      if (typeof data === 'string' || typeof data === 'number') {
        // When displaying as RichText but source is another type, fall back to source-aware stringify
        if (type === FieldType.RichText && sourceType !== type) {
          return stringifyFromSource(cell, field, sourceType, currentUser);
        }

        return String(data);
      }

      return '';
    }
  }
}

function stringifyFromSource(
  cell: YDatabaseCell,
  field: YDatabaseField | undefined,
  sourceType: FieldType,
  currentUser?: User
): string {
  const data = cell.get(YjsDatabaseKey.data);

  switch (sourceType) {
    case FieldType.Number:
      return typeof data === 'number' || typeof data === 'string' ? String(data) : '';
    case FieldType.DateTime: {
      const dateCell = parseYDatabaseDateTimeCellToCell(cell);

      if (!field) return String(data);
      return getDateCellStr({ cell: dateCell, field, currentUser });
    }

    case FieldType.SingleSelect:
    case FieldType.MultiSelect: {
      if (!field) return '';
      const options = parseSelectOptionTypeOptions(field)?.options || [];

      if (typeof data === 'string') {
        return data
          .split(',')
          .map((id) => options.find((opt) => opt.id === id || opt.name === id)?.name)
          .filter(Boolean)
          .join(',');
      }

      return '';
    }

    case FieldType.Checkbox:
      if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
        return parseCheckboxValue(data) ? 'Yes' : 'No';
      }

      return '';
    case FieldType.Time:
      if (typeof data === 'number') return String(data);
      if (typeof data === 'string') return parseTimeStringToMs(data) ?? data;
      return '';
    case FieldType.URL:
      if (typeof data === 'string' || typeof data === 'number') {
        return String(data).trim();
      }

      return '';
    case FieldType.Checklist: {
      if (typeof data === 'string') {
        const parsed = parseChecklistFlexible(data);

        if (!parsed) return '';

        return stringifyChecklist(parsed.options || [], parsed.selectedOptionIds || []);
      }

      return '';
    }

    default:
      return typeof data === 'string' || typeof data === 'number' ? String(data) : '';
  }
}

function stringifyChecklistStruct(checklist: ChecklistCellData): string {
  return JSON.stringify({
    options: checklist.options || [],
    selected_option_ids: checklist.selectedOptionIds || [],
  });
}
