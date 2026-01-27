import { getCell } from '@/application/database-yjs/const';
import { FieldType } from '@/application/database-yjs/database.type';
import {
  CheckboxFilterCondition,
  parseSelectOptionTypeOptions,
  SelectOptionFilterCondition,
} from '@/application/database-yjs/fields';
import { parseChecklistFlexible } from '@/application/database-yjs/fields/checklist/parse';
import { parseCheckboxValue } from '@/application/database-yjs/fields/text/utils';
import { checkboxFilterCheck, selectOptionFilterCheck } from '@/application/database-yjs/filter';
import { Row } from '@/application/database-yjs/selector';
import { RowId, YDatabaseField, YDatabaseFilter, YDoc, YjsDatabaseKey } from '@/application/types';

export function groupByField(
  rows: Row[],
  rowMetas: Record<RowId, YDoc>,
  field: YDatabaseField,
  filter?: YDatabaseFilter
) {
  const fieldType = Number(field.get(YjsDatabaseKey.type));
  const isSelectOptionField = [FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType);

  if (isSelectOptionField) {
    return groupBySelectOption(rows, rowMetas, field, filter);
  }

  if (fieldType === FieldType.Checkbox) {
    return groupByCheckbox(rows, rowMetas, field, filter);
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
    // If row document isn't loaded yet, default to 'No' group
    // The card component will trigger loading via ensureRowDoc
    if (!rowMetas[row.id]) {
      const defaultGroupName = 'No';

      if (result.has(defaultGroupName)) {
        const group = result.get(defaultGroupName) ?? [];

        group.push(row);
        result.set(defaultGroupName, group);
      }

      return;
    }

    const cell = getCell(row.id, fieldId, rowMetas);
    const cellData = cell?.get(YjsDatabaseKey.data);
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
    result.set(fieldId, rows);
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
    // If row document isn't loaded yet, put in "No Status" group (fieldId)
    // The card component will trigger loading via ensureRowDoc
    if (!rowMetas[row.id]) {
      if (result.has(fieldId)) {
        const group = result.get(fieldId) ?? [];

        group.push(row);
        result.set(fieldId, group);
      }

      return;
    }

    const cell = getCell(row.id, fieldId, rowMetas);
    const cellData = cell?.get(YjsDatabaseKey.data);
    const sourceType = Number(
      cell?.get(YjsDatabaseKey.source_field_type) ?? cell?.get(YjsDatabaseKey.field_type)
    ) as FieldType;

    let selectedIds: string[] = [];

    if (sourceType === FieldType.Checklist && typeof cellData === 'string') {
      const checklist = parseChecklistFlexible(cellData);

      selectedIds =
        checklist?.selectedOptionIds
          ?.map((idOrName) => typeOption.options.find((opt) => opt.id === idOrName || opt.name === idOrName)?.id)
          .filter((id): id is string => Boolean(id)) ?? [];
    } else if (typeof cellData === 'string') {
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
