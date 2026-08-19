import dayjs from 'dayjs';
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import {
  ChecklistCellData,
  SelectOption,
  SelectOptionColor,
  generateOptionId,
  getDateCellStr,
  parseChecklistData,
  parseDesktopChecklistText,
  parseDesktopDateToUnixSeconds,
  parseChecklistFlexible,
  parseSelectOptionTypeOptions,
  stringifyChecklist,
} from '@/application/database-yjs/fields';
import {
  parseDesktopNumberValue,
  parseNumberTypeOptions,
  stringifyDesktopNumberValue,
} from '@/application/database-yjs/fields/number/parse';
import { isFileMediaItem } from '@/application/database-yjs/fields/media/parse';
import {
  parseCheckboxValue,
  parseDesktopCheckboxValue,
  parseDesktopI64,
  parseTimeStringToMs,
} from '@/application/database-yjs/fields/text/utils';
import { User, YDatabaseCell, YDatabaseField, YjsDatabaseKey } from '@/application/types';

import { getCellFieldTypeContext } from './cell.field-type';
import { Cell, DateTimeCell, FileMediaCell, FileMediaCellData } from './cell.type';

export function parseYDatabaseCommonCellToCell(cell: YDatabaseCell, fieldType?: FieldType): Cell {
  return {
    createdAt: Number(cell.get(YjsDatabaseKey.created_at)),
    lastModified: Number(cell.get(YjsDatabaseKey.last_modified)),
    fieldType: fieldType ?? getCellFieldTypeContext(cell).targetType,
    data: cell.get(YjsDatabaseKey.data),
  };
}

export function parseYDatabaseCellToCell(cell: YDatabaseCell, field?: YDatabaseField): Cell {
  const { storedType, targetType } = getCellFieldTypeContext(cell, field);

  let value = parseYDatabaseCommonCellToCell(cell, targetType);

  if (storedType !== targetType) {
    value.data = isCellDataTransformable(storedType, targetType)
      ? transformCellData(cell, storedType, targetType, field)
      : '';
  }

  if (targetType === FieldType.DateTime) {
    if (storedType !== FieldType.DateTime) {
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

  if (targetType === FieldType.Media) {
    value =
      storedType === FieldType.Media
        ? parseYDatabaseFileMediaCellToCell(cell)
        : ({ ...value, fieldType: FieldType.Media, data: [] } as FileMediaCell);
  }

  if (targetType === FieldType.Relation) {
    value =
      storedType === FieldType.Relation
        ? parseYDatabaseRelationCellToCell(cell)
        : { ...value, fieldType: FieldType.Relation, data: null };
  }

  return value;
}

/** Direct lazy conversions supported by Desktop's type-option decoder. */
export function isCellDataTransformable(sourceType: FieldType, targetType: FieldType): boolean {
  if (sourceType === targetType || targetType === FieldType.RichText) return true;

  if (sourceType === FieldType.RichText) {
    return [
      FieldType.SingleSelect,
      FieldType.MultiSelect,
      FieldType.URL,
      FieldType.Number,
      FieldType.DateTime,
      FieldType.Time,
      FieldType.Checklist,
      FieldType.Checkbox,
    ].includes(targetType);
  }

  if (sourceType === FieldType.Checkbox) {
    return targetType === FieldType.SingleSelect || targetType === FieldType.MultiSelect;
  }

  if (sourceType === FieldType.SingleSelect || sourceType === FieldType.MultiSelect) {
    return (
      targetType === FieldType.SingleSelect || targetType === FieldType.MultiSelect || targetType === FieldType.Checklist
    );
  }

  if (sourceType === FieldType.Checklist) {
    return targetType === FieldType.SingleSelect || targetType === FieldType.MultiSelect;
  }

  return (
    (sourceType === FieldType.CreatedTime || sourceType === FieldType.LastEditedTime) &&
    targetType === FieldType.DateTime
  );
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
        const parsed = parseDesktopChecklistText(data);

        return stringifyChecklistStruct(parsed);
      }

      if ((sourceType === FieldType.SingleSelect || sourceType === FieldType.MultiSelect) && field) {
        // Resolve options by the source select type — the field's current type
        // is Checklist here, so its own type-option holds no select options.
        const typeOption = parseSelectOptionTypeOptions(field, sourceType);
        const options = typeOption?.options || [];
        const selectedIds = new Set(data.split(',').filter(Boolean));
        const checklistOptions: SelectOption[] = [];
        const checklistSelectedIds: string[] = [];

        options.forEach((opt) => {
          const newOpt = {
            id: generateOptionId(),
            name: opt.name,
            color: SelectOptionColor.OptionColor1,
          };

          checklistOptions.push(newOpt);
          if (selectedIds.has(opt.id)) {
            checklistSelectedIds.push(newOpt.id);
          }
        });

        if (options.length === 0) {
          selectedIds.forEach((id) => {
            const option: SelectOption = {
              id: generateOptionId(),
              name: id,
              color: SelectOptionColor.OptionColor1,
            };

            checklistOptions.push(option);
            checklistSelectedIds.push(option.id);
          });
        }

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

      // SingleSelect <-> MultiSelect: the switch copies the options 1:1, so the
      // stored option IDs stay valid — keep them (desktop parity:
      // SelectOptionIds::from(cell)). Without this the data would be dropped.
      // Early-return before parsing options (which this path does not need).
      if (sourceType === FieldType.SingleSelect || sourceType === FieldType.MultiSelect) {
        return typeof data === 'string' ? data : '';
      }

      const typeOption = parseSelectOptionTypeOptions(field);
      const options = typeOption?.options || [];

      if (sourceType === FieldType.Checklist && typeof data === 'string') {
        const checklist = parseChecklistData(data);

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
        const ids = names.map((name) => options.find((o) => o.name === name)?.id).filter(Boolean);

        if (ids.length === 0) {
          const exactMatch = options.find((option) => option.name === data);

          if (exactMatch) ids.push(exactMatch.id);
        }

        return ids.join(',');
      }

      // Checkbox → SingleSelect/MultiSelect: map "Yes"/"No" to option IDs
      if (
        sourceType === FieldType.Checkbox &&
        (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean')
      ) {
        const isChecked = parseDesktopCheckboxValue(data);
        const targetName = isChecked ? 'Yes' : 'No';
        const matchingOption = options.find((o) => o.name === targetName);

        return matchingOption?.id || '';
      }

      return '';
    }

    case FieldType.Number:
      if (typeof data === 'string' || typeof data === 'number') {
        return parseDesktopNumberValue(data, field ? parseNumberTypeOptions(field).format : 0);
      }

      return '';

    case FieldType.DateTime: {
      // text -> DateTime: parse a free-text date into a unix timestamp in
      // SECONDS (desktop parity: cast_string_to_timestamp). A materialized
      // Created/LastEditedTime timestamp keeps Desktop's direct i64 value.
      if (typeof data !== 'string' && typeof data !== 'number') return '';
      const raw = String(data);

      if (!raw) return '';
      const parsed =
        sourceType === FieldType.CreatedTime || sourceType === FieldType.LastEditedTime
          ? parseDesktopI64(raw)
          : parseDesktopDateToUnixSeconds(raw);

      return parsed ?? '';
    }

    case FieldType.Checkbox:
      if (sourceType === FieldType.RichText) {
        if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
          return parseDesktopCheckboxValue(data) ? 'Yes' : 'No';
        }

        return '';
      }

      // SingleSelect/MultiSelect → Checkbox: check if selected option name/id is "Yes"
      if (sourceType === FieldType.SingleSelect || sourceType === FieldType.MultiSelect) {
        if (typeof data === 'string' && data) {
          const selectedIds = data.split(',');
          // First, try to look up option names from field type_option (if still available).
          // Resolve by the source select type: the field's current type is Checkbox here.
          const typeOption = field ? parseSelectOptionTypeOptions(field, sourceType) : null;
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
      fieldType: FieldType.Media,
    } as FileMediaCell;
  }

  // Convert YArray<string> to FileMediaCellData. A cell that was lazily
  // converted from another list-shaped type still holds that type's entries,
  // so drop anything that is not a media item rather than throwing.
  const entries = data.toJSON() as string[];
  const dataJson: FileMediaCellData = [];

  entries.forEach((item) => {
    try {
      const parsed = JSON.parse(item);

      if (isFileMediaItem(parsed)) {
        dataJson.push(parsed);
      }
    } catch (e) {
      // Not a media entry; skip it.
    }
  });

  return {
    ...parseYDatabaseCommonCellToCell(cell),
    data: dataJson,
    fieldType: FieldType.Media,
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
  const { targetType: type } = getCellFieldTypeContext(cell, field);
  const parsedCell = parseYDatabaseCellToCell(cell, field);
  const data = parsedCell.data;

  switch (type) {
    case FieldType.SingleSelect:
    case FieldType.MultiSelect: {
      const options = parseSelectOptionTypeOptions(field)?.options || [];

      if (typeof data === 'string') {
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
      if (typeof data === 'string') {
        const parsed = parseChecklistFlexible(data);

        if (!parsed) return '';
        return stringifyChecklist(parsed.options || [], parsed.selectedOptionIds || []);
      }

      return '';
    }

    case FieldType.Checkbox: {
      if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
        const isChecked = parseCheckboxValue(data);

        return isChecked ? 'Yes' : 'No';
      }

      return '';
    }

    case FieldType.Time: {
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
      if (typeof data === 'string' || typeof data === 'number') {
        return String(data).trim();
      }

      return '';
    }

    case FieldType.DateTime: {
      return getDateCellStr({ cell: parsedCell as DateTimeCell, field, currentUser });
    }

    case FieldType.CreatedTime:
    case FieldType.LastEditedTime:
    case FieldType.Relation:
      return '';

    default: {
      if (typeof data === 'string' || typeof data === 'number') {
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
      if (typeof data !== 'number' && typeof data !== 'string') return '';
      return stringifyDesktopNumberValue(data, field ? parseNumberTypeOptions(field, FieldType.Number).format : 0);
    case FieldType.DateTime: {
      const dateCell = parseYDatabaseDateTimeCellToCell(cell);

      if (!field) return String(data);
      return getDateCellStr({ cell: dateCell, field, currentUser });
    }

    case FieldType.SingleSelect:
    case FieldType.MultiSelect: {
      if (!field) return '';
      // The field's current type is no longer a select (we are stringifying a
      // converted-to-text cell), so resolve options by the source select type.
      const options = parseSelectOptionTypeOptions(field, sourceType)?.options || [];

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
        return parseDesktopCheckboxValue(data) ? 'Yes' : 'No';
      }

      return '';
    case FieldType.Time:
      if (typeof data === 'number' || typeof data === 'string') return parseDesktopI64(data) ?? '';
      return '';
    case FieldType.URL:
      if (typeof data === 'string' || typeof data === 'number') {
        return String(data);
      }

      return '';
    case FieldType.Checklist: {
      if (typeof data === 'string') {
        const parsed = parseChecklistData(data);

        if (!parsed) return '';

        return stringifyChecklist(parsed.options || [], parsed.selectedOptionIds || []);
      }

      return '';
    }

    case FieldType.CreatedTime:
    case FieldType.LastEditedTime: {
      if (typeof data !== 'string' && typeof data !== 'number') return '';
      const parsedTimestamp = parseDesktopI64(data);

      if (parsedTimestamp === null) return '';
      return dayjs.unix(Number(parsedTimestamp)).format('MMM DD, YYYY HH:mm');
    }

    case FieldType.Media: {
      if (!(data instanceof Y.Array)) return '';

      return data
        .toArray()
        .map((item) => {
          if (typeof item !== 'string') return '';
          try {
            const file = JSON.parse(item) as { name?: unknown };

            return typeof file.name === 'string' ? file.name : '';
          } catch {
            return '';
          }
        })
        .join(', ');
    }

    case FieldType.Relation:
    case FieldType.Person:
    case FieldType.Rollup:
      return '';

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
