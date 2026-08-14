import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { hasRowConditionData } from '@/application/database-yjs/condition-value-cache';
import { getCell } from '@/application/database-yjs/const';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import {
  CheckboxFilterCondition,
  parseSelectOptionTypeOptions,
  SelectOptionFilterCondition,
} from '@/application/database-yjs/fields';
import { parseCheckboxValue } from '@/application/database-yjs/fields/text/utils';
import { checkboxFilterCheck, selectOptionFilterCheck } from '@/application/database-yjs/filter';
import type { Row } from '@/application/database-yjs/selector';
import { RowId, YDatabaseField, YDatabaseFilter, YDoc, YjsDatabaseKey } from '@/application/types';

const NUMBER_GROUP_INTERVAL = 100;

export const DATABASE_GROUPABLE_FIELD_TYPES: readonly FieldType[] = [
  FieldType.RichText,
  FieldType.Number,
  FieldType.URL,
  FieldType.Checkbox,
  FieldType.SingleSelect,
  FieldType.MultiSelect,
  FieldType.DateTime,
];

export const DATABASE_DYNAMIC_GROUP_FIELD_TYPES: readonly FieldType[] = [
  FieldType.RichText,
  FieldType.Number,
  FieldType.URL,
  FieldType.DateTime,
];

export interface DateGroupConfiguration {
  condition: DateGroupCondition;
  hide_empty: boolean;
}

export function isDatabaseGroupableFieldType(fieldType: FieldType): boolean {
  return DATABASE_GROUPABLE_FIELD_TYPES.includes(fieldType);
}

export function isDynamicDatabaseGroupFieldType(fieldType: FieldType): boolean {
  return DATABASE_DYNAMIC_GROUP_FIELD_TYPES.includes(fieldType);
}

export function parseDateGroupConfiguration(content?: string): DateGroupConfiguration {
  if (!content) {
    return {
      condition: DateGroupCondition.Relative,
      hide_empty: false,
    };
  }

  try {
    const parsed = JSON.parse(content) as Partial<DateGroupConfiguration>;
    const condition = Number(parsed.condition);

    return {
      condition:
        condition >= DateGroupCondition.Relative && condition <= DateGroupCondition.Year
          ? (condition as DateGroupCondition)
          : DateGroupCondition.Relative,
      hide_empty: Boolean(parsed.hide_empty),
    };
  } catch {
    return {
      condition: DateGroupCondition.Relative,
      hide_empty: false,
    };
  }
}

export function areGroupRowsHydrated(rows: Row[], rowMetas: Record<RowId, YDoc>) {
  return rows.every((row) => hasRowConditionData(rowMetas[row.id]));
}

export function groupByField(
  rows: Row[],
  rowMetas: Record<RowId, YDoc>,
  field: YDatabaseField,
  filter?: YDatabaseFilter,
  groupContent?: string
) {
  const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;
  const isSelectOptionField = [FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType);

  if (isSelectOptionField) {
    return groupBySelectOption(rows, rowMetas, field, filter);
  }

  if (fieldType === FieldType.Checkbox) {
    return groupByCheckbox(rows, rowMetas, field, filter);
  }

  if ([FieldType.RichText, FieldType.URL].includes(fieldType)) {
    return groupByText(rows, rowMetas, field);
  }

  if (fieldType === FieldType.Number) {
    return groupByNumber(rows, rowMetas, field);
  }

  if (fieldType === FieldType.DateTime) {
    return groupByDate(rows, rowMetas, field, groupContent);
  }

  return;
}

export function getGroupColumns(field: YDatabaseField) {
  const fieldType = Number(field.get(YjsDatabaseKey.type));
  const isSelectOptionField = [FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType);

  if (isSelectOptionField) {
    const typeOption = parseSelectOptionTypeOptions(field);

    if (!typeOption || typeOption.options.length === 0) {
      return [{ id: field.get(YjsDatabaseKey.id) }];
    }

    const options = typeOption.options
      .map((option) => ({
        id: option?.id,
      }))
      .filter((option): option is { id: string } => Boolean(option.id));

    return [{ id: field.get(YjsDatabaseKey.id) }, ...options];
  }

  if (fieldType === FieldType.Checkbox) {
    return [{ id: 'Yes' }, { id: 'No' }];
  }

  if (isDatabaseGroupableFieldType(fieldType)) {
    return [{ id: field.get(YjsDatabaseKey.id) }];
  }
}

function getGroupingCellData(rowId: RowId, rowMetas: Record<RowId, YDoc>, field: YDatabaseField) {
  const fieldId = field.get(YjsDatabaseKey.id);
  const cell = getCell(rowId, fieldId, rowMetas);

  return cell ? parseYDatabaseCellToCell(cell, field).data : undefined;
}

export function groupByText(rows: Row[], rowMetas: Record<RowId, YDoc>, field: YDatabaseField) {
  const fieldId = field.get(YjsDatabaseKey.id);
  const result = new Map<string, Row[]>([[fieldId, []]]);

  rows.forEach((row) => {
    if (!hasRowConditionData(rowMetas[row.id])) return;

    const rawValue = getGroupingCellData(row.id, rowMetas, field);
    const value = typeof rawValue === 'string' || typeof rawValue === 'number' ? String(rawValue) : '';
    const groupId = value.trim() ? value : fieldId;
    const groupRows = result.get(groupId) ?? [];

    groupRows.push(row);
    result.set(groupId, groupRows);
  });

  return result;
}

export function getNumberGroupId(value: unknown): string | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;

  const parsed = Number(String(value).replaceAll(',', ''));

  if (!Number.isFinite(parsed)) return null;

  const start = Math.floor(parsed / NUMBER_GROUP_INTERVAL) * NUMBER_GROUP_INTERVAL;

  return `number_range_${start}_${start + NUMBER_GROUP_INTERVAL}`;
}

function getNumberGroupStart(groupId: string): number {
  if (!groupId.startsWith('number_range_')) return Number.NEGATIVE_INFINITY;

  const match = /^number_range_(-?\d+(?:\.\d+)?)_/.exec(groupId);

  return match ? Number(match[1]) : Number.NEGATIVE_INFINITY;
}

export function groupByNumber(rows: Row[], rowMetas: Record<RowId, YDoc>, field: YDatabaseField) {
  const fieldId = field.get(YjsDatabaseKey.id);
  const dynamicGroups = new Map<string, Row[]>();
  const ungroupedRows: Row[] = [];

  rows.forEach((row) => {
    if (!hasRowConditionData(rowMetas[row.id])) return;

    const groupId = getNumberGroupId(getGroupingCellData(row.id, rowMetas, field));

    if (!groupId) {
      ungroupedRows.push(row);
      return;
    }

    const groupRows = dynamicGroups.get(groupId) ?? [];

    groupRows.push(row);
    dynamicGroups.set(groupId, groupRows);
  });

  const result = new Map<string, Row[]>([[fieldId, ungroupedRows]]);

  [...dynamicGroups.entries()]
    .sort(([left], [right]) => getNumberGroupStart(left) - getNumberGroupStart(right))
    .forEach(([groupId, groupRows]) => result.set(groupId, groupRows));

  return result;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  const result = new Date(date);

  result.setDate(result.getDate() + days);
  return result;
}

function formatDateGroupId(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}/${month}/${day}`;
}

function dateFromCellValue(value: unknown): Date | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;

  const timestamp = Number(value);

  if (!Number.isFinite(timestamp)) return null;

  const date = new Date(Math.abs(timestamp) < 1_000_000_000_000 ? timestamp * 1000 : timestamp);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function getDateGroupId(value: unknown, condition: DateGroupCondition, now: Date = new Date()): string | null {
  const date = dateFromCellValue(value);

  if (!date) return null;

  const localDate = startOfLocalDay(date);
  let groupDate = localDate;

  switch (condition) {
    case DateGroupCondition.Day:
      break;
    case DateGroupCondition.Week: {
      const mondayOffset = (localDate.getDay() + 6) % 7;

      groupDate = addLocalDays(localDate, -mondayOffset);
      break;
    }

    case DateGroupCondition.Month:
      groupDate = new Date(localDate.getFullYear(), localDate.getMonth(), 1);
      break;
    case DateGroupCondition.Year:
      groupDate = new Date(localDate.getFullYear(), 0, 1);
      break;
    case DateGroupCondition.Relative: {
      const today = startOfLocalDay(now);
      const diff = Math.round((localDate.getTime() - today.getTime()) / 86_400_000);

      if (diff === 0) groupDate = today;
      else if (diff === -1) groupDate = addLocalDays(today, -1);
      else if (diff === 1) groupDate = addLocalDays(today, 1);
      else if (diff >= -7 && diff < -1) groupDate = addLocalDays(today, -7);
      else if (diff > 1 && diff <= 7) groupDate = addLocalDays(today, 2);
      else if (diff >= -30 && diff < -7) groupDate = addLocalDays(today, -30);
      else if (diff > 7 && diff <= 30) groupDate = addLocalDays(today, 8);
      else {
        groupDate = new Date(localDate.getFullYear(), localDate.getMonth(), 1);
        const monthStartDiff = Math.round((groupDate.getTime() - today.getTime()) / 86_400_000);

        if (monthStartDiff > 7 && monthStartDiff <= 30) {
          groupDate = addLocalDays(groupDate, 31 - monthStartDiff);
        }
      }

      break;
    }
  }

  return formatDateGroupId(groupDate);
}

export function groupByDate(
  rows: Row[],
  rowMetas: Record<RowId, YDoc>,
  field: YDatabaseField,
  groupContent?: string,
  now: Date = new Date()
) {
  const fieldId = field.get(YjsDatabaseKey.id);
  const configuration = parseDateGroupConfiguration(groupContent);
  const dynamicGroups = new Map<string, Row[]>();
  const ungroupedRows: Row[] = [];

  rows.forEach((row) => {
    if (!hasRowConditionData(rowMetas[row.id])) return;

    const groupId = getDateGroupId(getGroupingCellData(row.id, rowMetas, field), configuration.condition, now);

    if (!groupId) {
      ungroupedRows.push(row);
      return;
    }

    const groupRows = dynamicGroups.get(groupId) ?? [];

    groupRows.push(row);
    dynamicGroups.set(groupId, groupRows);
  });

  const result = new Map<string, Row[]>([[fieldId, ungroupedRows]]);

  [...dynamicGroups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([groupId, groupRows]) => result.set(groupId, groupRows));

  return result;
}

function parseDateGroupId(groupId: string): Date | null {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(groupId);

  if (!match) return null;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatMonthDay(date: Date, includeYear = true) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    ...(includeYear ? { year: 'numeric' as const } : {}),
  }).format(date);
}

export function getGroupLabel(
  groupId: string,
  field: YDatabaseField,
  groupContent?: string,
  now: Date = new Date()
): string {
  const fieldId = field.get(YjsDatabaseKey.id);
  const fieldName = field.get(YjsDatabaseKey.name) || '';

  if (groupId === fieldId) return `No ${fieldName}`.trim();

  const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;

  if ([FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType)) {
    return parseSelectOptionTypeOptions(field)?.options.find((option) => option.id === groupId)?.name ?? groupId;
  }

  if (fieldType === FieldType.Number) {
    const match = /^number_range_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)$/.exec(groupId);

    return match ? `${match[1]} to ${match[2]}` : groupId;
  }

  if (fieldType === FieldType.DateTime) {
    const date = parseDateGroupId(groupId);

    if (!date) return groupId;

    const configuration = parseDateGroupConfiguration(groupContent);

    if (configuration.condition === DateGroupCondition.Year) return String(date.getFullYear());
    if (configuration.condition === DateGroupCondition.Month) {
      return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(date);
    }

    if (configuration.condition === DateGroupCondition.Week) {
      return `Week of ${formatMonthDay(date, false)} - ${formatMonthDay(addLocalDays(date, 6))}`;
    }

    if (configuration.condition === DateGroupCondition.Relative) {
      const today = startOfLocalDay(now);
      const relativeLabels = new Map<string, string>([
        [formatDateGroupId(today), 'Today'],
        [formatDateGroupId(addLocalDays(today, -1)), 'Yesterday'],
        [formatDateGroupId(addLocalDays(today, 1)), 'Tomorrow'],
        [formatDateGroupId(addLocalDays(today, -7)), 'Last 7 days'],
        [formatDateGroupId(addLocalDays(today, 2)), 'Next 7 days'],
        [formatDateGroupId(addLocalDays(today, -30)), 'Last 30 days'],
        [formatDateGroupId(addLocalDays(today, 8)), 'Next 30 days'],
      ]);

      return (
        relativeLabels.get(groupId) ??
        new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(date)
      );
    }

    return formatMonthDay(date);
  }

  return groupId;
}

export function getGroupCellData(groupId: string, field: YDatabaseField): string | undefined {
  const fieldId = field.get(YjsDatabaseKey.id);

  if (groupId === fieldId) return undefined;

  const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;

  if (fieldType === FieldType.Number) {
    const match = /^number_range_(-?\d+(?:\.\d+)?)_/.exec(groupId);

    return match?.[1];
  }

  if (fieldType === FieldType.DateTime) {
    const date = parseDateGroupId(groupId);

    return date ? String(Math.floor(date.getTime() / 1000)) : undefined;
  }

  return groupId;
}

export function groupByCheckbox(
  rows: Row[],
  rowMetas: Record<RowId, YDoc>,
  field: YDatabaseField,
  filter?: YDatabaseFilter
) {
  const fieldId = field.get(YjsDatabaseKey.id);
  const result = new Map<string, Row[]>();

  ['Yes', 'No'].forEach((groupName) => {
    if (filter) {
      const condition = Number(filter?.get(YjsDatabaseKey.condition)) as CheckboxFilterCondition;

      if (!checkboxFilterCheck(groupName, condition)) {
        result.delete(groupName);
        return;
      }
    }

    result.set(groupName, []);
  });

  rows.forEach((row) => {
    // Rendering an unloaded row in a guessed group lets hydration move its
    // card between columns during a pointer gesture. The board hydrates group
    // rows in the background, so only expose a row once its real value is
    // available.
    if (!hasRowConditionData(rowMetas[row.id])) return;

    const cell = getCell(row.id, fieldId, rowMetas);
    const cellData = cell ? parseYDatabaseCellToCell(cell, field).data : undefined;
    const checked = parseCheckboxValue(cellData as string);
    const groupName = checked ? 'Yes' : 'No';

    if (!result.has(groupName)) {
      return;
    }

    const group = result.get(groupName) ?? [];

    group.push(row);
    result.set(groupName, group);
  });
  return result;
}

export function groupBySelectOption(
  rows: Row[],
  rowMetas: Record<RowId, YDoc>,
  field: YDatabaseField,
  filter?: YDatabaseFilter
) {
  const fieldId = field.get(YjsDatabaseKey.id);
  const result = new Map<string, Row[]>();
  const typeOption = parseSelectOptionTypeOptions(field);

  if (!typeOption || typeOption.options.length === 0) {
    result.set(
      fieldId,
      rows.filter((row) => hasRowConditionData(rowMetas[row.id]))
    );
    return result;
  }

  const filterCondition = filter
    ? (Number(filter?.get(YjsDatabaseKey.condition)) as SelectOptionFilterCondition)
    : undefined;
  const filterContent = filter?.get(YjsDatabaseKey.content) ?? '';

  const shouldIncludeEmptyGroup = filter
    ? selectOptionFilterCheck(field, '', filterContent, filterCondition as SelectOptionFilterCondition)
    : true;

  if (shouldIncludeEmptyGroup) {
    result.set(fieldId, []);
  }

  typeOption.options.forEach((option) => {
    const groupName = option?.id;

    if (!groupName) {
      return;
    }

    if (filter) {
      if (!selectOptionFilterCheck(field, groupName, filterContent, filterCondition as SelectOptionFilterCondition)) {
        result.delete(groupName);
        return;
      }
    }

    result.set(groupName, []);
  });

  rows.forEach((row) => {
    // Do not guess "No Status" for an unloaded row. Moving that row after
    // hydration can unmount a card between pointer-down and click.
    if (!hasRowConditionData(rowMetas[row.id])) return;

    const cell = getCell(row.id, fieldId, rowMetas);
    const cellData = cell ? parseYDatabaseCellToCell(cell, field).data : undefined;

    let selectedIds: string[] = [];

    if (typeof cellData === 'string') {
      selectedIds =
        cellData
          .split(',')
          .map((v) => v.trim())
          .map((idOrName) => typeOption.options.find((opt) => opt.id === idOrName || opt.name === idOrName)?.id)
          .filter((id): id is string => Boolean(id)) ?? [];
    }

    if (selectedIds.length === 0) {
      if (!result.has(fieldId)) {
        return;
      }

      const group = result.get(fieldId) ?? [];

      group.push(row);
      result.set(fieldId, group);
      return;
    }

    selectedIds.forEach((id) => {
      const option = typeOption.options.find((option) => option?.id === id);
      const groupName = option?.id ?? fieldId;

      if (!result.has(groupName)) {
        return;
      }

      const group = result.get(groupName) ?? [];

      group.push(row);
      result.set(groupName, group);
    });
  });

  return result;
}
