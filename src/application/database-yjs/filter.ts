import { parseYDatabaseDateTimeCellToCell } from '@/application/database-yjs/cell.parse';
import { DateTimeCell } from '@/application/database-yjs/cell.type';
import EnhancedBigStats from '@/application/database-yjs/fields/number/EnhancedBigStats';
import {
  RowId, YDatabaseField,
  YDatabaseFields,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { FieldType } from '@/application/database-yjs/database.type';
import {
  CheckboxFilter,
  CheckboxFilterCondition,
  ChecklistFilter,
  ChecklistFilterCondition,
  DateFilter, DateFilterCondition,
  NumberFilter,
  NumberFilterCondition,
  parseChecklistData,
  SelectOptionFilter,
  SelectOptionFilterCondition,
  TextFilter,
  TextFilterCondition,
} from '@/application/database-yjs/fields';
import { Row } from '@/application/database-yjs/selector';
import { isTimestampBefore, isTimestampBetweenRange, isTimestampInSameDay } from '@/utils/time';
import dayjs from 'dayjs';
import { every, filter, some } from 'lodash-es';

export function parseFilter (fieldType: FieldType, filter: YDatabaseFilter) {
  const fieldId = filter.get(YjsDatabaseKey.field_id);
  const filterType = Number(filter.get(YjsDatabaseKey.filter_type));
  const id = filter.get(YjsDatabaseKey.id);
  const content = filter.get(YjsDatabaseKey.content);
  const condition = Number(filter.get(YjsDatabaseKey.condition));

  const value = {
    fieldId,
    filterType,
    condition,
    id,
    content,
  };

  switch (fieldType) {
    case FieldType.URL:
    case FieldType.RichText:
      return value as TextFilter;
    case FieldType.Number:
      return value as NumberFilter;
    case FieldType.Checklist:
      return value as ChecklistFilter;
    case FieldType.Checkbox:
      return value as CheckboxFilter;
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
      // eslint-disable-next-line no-case-declarations
      const options = content.split(',');

      return {
        ...value,
        optionIds: options,
      } as SelectOptionFilter;
    case FieldType.DateTime:
    case FieldType.CreatedTime:
    case FieldType.LastEditedTime:
      try {
        const data = JSON.parse(content) as DateFilter;

        return {
          ...value,
          ...data,
        };
      } catch (e) {
        console.error('Error parsing date filter content:', e);
        return {
          ...value,
          timestamp: dayjs().startOf('day').unix(),
          condition: DateFilterCondition.DateStartsOn,
        };
      }
  }

  return value;
}

function createPredicate (conditions: ((row: Row) => boolean)[]) {
  return function (item: Row) {
    return every(conditions, (condition) => condition(item));
  };
}

export function filterBy (rows: Row[], filters: YDatabaseFilters, fields: YDatabaseFields, rowMetas: Record<RowId, YDoc>) {
  const filterArray = filters.toArray();

  if (filterArray.length === 0 || Object.keys(rowMetas).length === 0 || fields.size === 0) return rows;

  const conditions = filterArray.map((filter) => {
    return (row: { id: string }) => {
      const fieldId = filter.get(YjsDatabaseKey.field_id);
      const field = fields.get(fieldId);
      const fieldType = Number(field.get(YjsDatabaseKey.type));
      const rowId = row.id;
      const rowMeta = rowMetas[rowId];

      if (!rowMeta) return false;
      const filterValue = parseFilter(fieldType, filter);
      const meta = rowMeta.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

      if (!meta) return false;

      const cells = meta.get(YjsDatabaseKey.cells);
      const cell = cells.get(fieldId);

      const { condition, content } = filterValue;

      const cellData = (cell?.get(YjsDatabaseKey.data) as string) || '';

      switch (fieldType) {
        case FieldType.URL:
        case FieldType.RichText:
          return textFilterCheck(cellData, content, condition);
        case FieldType.Number:
          return numberFilterCheck(cellData, content, condition);
        case FieldType.Checkbox:
          return checkboxFilterCheck(cellData, condition);
        case FieldType.SingleSelect:
        case FieldType.MultiSelect:
          return selectOptionFilterCheck(cellData, content, condition);
        case FieldType.Checklist:
          return checklistFilterCheck(cellData, content, condition);
        case FieldType.DateTime:
        case FieldType.CreatedTime:
        case FieldType.LastEditedTime:
          return dateFilterCheck(cell ? parseYDatabaseDateTimeCellToCell(cell) : null, filterValue as DateFilter);
        default:
          return true;
      }
    };
  });
  const predicate = createPredicate(conditions);

  return filter(rows, predicate);
}

export function textFilterCheck (data: string, content: string, condition: TextFilterCondition) {
  switch (condition) {
    case TextFilterCondition.TextContains:
      return data.includes(content);
    case TextFilterCondition.TextDoesNotContain:
      return !data.includes(content);
    case TextFilterCondition.TextIs:
      return data === content;
    case TextFilterCondition.TextIsNot:
      return data !== content;
    case TextFilterCondition.TextIsEmpty:
      return data === '';
    case TextFilterCondition.TextIsNotEmpty:
      return data !== '';
    default:
      return false;
  }
}

export function numberFilterCheck (data: string, content: string, condition: number) {
  if (isNaN(Number(data)) || isNaN(Number(content)) || data === '' || content === '') {
    if (condition === NumberFilterCondition.NumberIsEmpty) {
      return data === '';
    }

    if (condition === NumberFilterCondition.NumberIsNotEmpty) {
      return data !== '';
    }

    return false;
  }

  const res = EnhancedBigStats.compare(data, content);

  switch (condition) {
    case NumberFilterCondition.Equal:
      return res === 0;
    case NumberFilterCondition.NotEqual:
      return res !== 0;
    case NumberFilterCondition.GreaterThan:
      return res > 0;
    case NumberFilterCondition.GreaterThanOrEqualTo:
      return res >= 0;
    case NumberFilterCondition.LessThan:
      return res < 0;
    case NumberFilterCondition.LessThanOrEqualTo:
      return res <= 0;
    default:
      return false;
  }
}

export function checkboxFilterCheck (data: string, condition: number) {
  switch (condition) {
    case CheckboxFilterCondition.IsChecked:
      return data === 'Yes';
    case CheckboxFilterCondition.IsUnChecked:
      return data !== 'Yes';
    default:
      return false;
  }
}

export function checklistFilterCheck (data: string, content: string, condition: number) {
  const percentage = parseChecklistData(data)?.percentage ?? 0;

  if (condition === ChecklistFilterCondition.IsComplete) {
    return percentage === 1;
  }

  return percentage !== 1;
}

export function dateFilterCheck (cell: DateTimeCell | null, filter: DateFilter) {
  const { condition, end = '', start = '', timestamp = '' } = filter;

  const { data = '', endTimestamp = '' } = cell || {};

  switch (condition) {
    case DateFilterCondition.DateEndIsEmpty:
    case DateFilterCondition.DateStartIsEmpty:
      return !data;
    case DateFilterCondition.DateEndIsNotEmpty:
    case DateFilterCondition.DateStartIsNotEmpty:
      return !!data;
    case DateFilterCondition.DateStartsOn:
      return isTimestampInSameDay(data, timestamp.toString());
    case DateFilterCondition.DateEndsOn:
      return isTimestampInSameDay(endTimestamp, timestamp.toString());
    case DateFilterCondition.DateStartsBefore:
      return isTimestampBefore(data, timestamp.toString());
    case DateFilterCondition.DateEndsBefore:
      return isTimestampBefore(endTimestamp, timestamp.toString());
    case DateFilterCondition.DateStartsAfter:
      return isTimestampBefore(timestamp.toString(), data);
    case DateFilterCondition.DateEndsAfter:
      return isTimestampBefore(timestamp.toString(), endTimestamp);
    case DateFilterCondition.DateStartsOnOrBefore:
      return isTimestampBefore(data, timestamp.toString()) || isTimestampInSameDay(data, timestamp.toString());
    case DateFilterCondition.DateEndsOnOrBefore:
      return isTimestampBefore(endTimestamp, timestamp.toString()) || isTimestampInSameDay(endTimestamp, timestamp.toString());
    case DateFilterCondition.DateStartsOnOrAfter:
      return isTimestampBefore(timestamp.toString(), data) || isTimestampInSameDay(timestamp.toString(), data);
    case DateFilterCondition.DateEndsOnOrAfter:
      return isTimestampBefore(timestamp.toString(), endTimestamp) || isTimestampInSameDay(timestamp.toString(), endTimestamp);
    case DateFilterCondition.DateStartsBetween:
      return isTimestampBetweenRange(data, start.toString(), end.toString());
    case DateFilterCondition.DateEndsBetween:
      return isTimestampBetweenRange(endTimestamp, start.toString(), end.toString());
    default:
      return false;
  }

}

export function selectOptionFilterCheck (data: string, content: string, condition: number) {
  if (SelectOptionFilterCondition.OptionIsEmpty === condition) {
    return data === '';
  }

  if (SelectOptionFilterCondition.OptionIsNotEmpty === condition) {
    return data !== '';
  }

  const selectedOptionIds = data.split(',');
  const filterOptionIds = content.split(',');

  switch (condition) {
    // Ensure all filterOptionIds are included in selectedOptionIds
    case SelectOptionFilterCondition.OptionIs:
      return every(filterOptionIds, (option) => selectedOptionIds.includes(option));

    // Ensure none of the filterOptionIds are included in selectedOptionIds
    case SelectOptionFilterCondition.OptionIsNot:
      return every(filterOptionIds, (option) => !selectedOptionIds.includes(option));

    // Ensure at least one of the filterOptionIds is included in selectedOptionIds
    case SelectOptionFilterCondition.OptionContains:
      return some(filterOptionIds, (option) => selectedOptionIds.includes(option));

    // Ensure at least one of the filterOptionIds is not included in selectedOptionIds
    case SelectOptionFilterCondition.OptionDoesNotContain:
      return some(filterOptionIds, (option) => !selectedOptionIds.includes(option));

    // Default case, if no conditions match
    default:
      return false;
  }
}

// Return the default value for the filter
export function textFilterFillData (content: string, condition: number) {
  switch (condition) {
    case TextFilterCondition.TextContains:
      return content;
    case TextFilterCondition.TextDoesNotContain:
      return '';
    case TextFilterCondition.TextIs:
      return content;
    case TextFilterCondition.TextIsNot:
      return '';
    case TextFilterCondition.TextIsEmpty:
      return '';
    case TextFilterCondition.TextIsNotEmpty:
      return 'Untitled';
    default:
      return '';
  }
}

export function numberFilterFillData (content: string, condition: number) {
  switch (condition) {
    case NumberFilterCondition.Equal:
      return content;
    case NumberFilterCondition.NotEqual:
      return '';
    case NumberFilterCondition.GreaterThan:
      return Number(content) + 1;
    case NumberFilterCondition.GreaterThanOrEqualTo:
      return content;
    case NumberFilterCondition.LessThan:
      return Number(content) - 1;
    case NumberFilterCondition.LessThanOrEqualTo:
      return content;
    default:
      return '';
  }
}

export function checkboxFilterFillData (condition: number) {
  switch (condition) {
    case CheckboxFilterCondition.IsChecked:
      return 'Yes';
    case CheckboxFilterCondition.IsUnChecked:
      return 'No';
    default:
      return '';
  }
}

export function checklistFilterFillData (content: string, condition: number) {
  switch (condition) {
    case ChecklistFilterCondition.IsComplete:
      return JSON.stringify({
        options: [
          {
            id: '1',
            name: 'Task',
          },
        ],
        selected_option_ids: ['1'],
      });
    default:
      return '';
  }
}

export function selectOptionFilterFillData (content: string, condition: number) {
  switch (condition) {
    case SelectOptionFilterCondition.OptionIs:
      return content;
    case SelectOptionFilterCondition.OptionIsNot:
      return '';
    case SelectOptionFilterCondition.OptionContains:
      return content;
    case SelectOptionFilterCondition.OptionDoesNotContain:
      return '';
    case SelectOptionFilterCondition.OptionIsEmpty:
      return '';
    case SelectOptionFilterCondition.OptionIsNotEmpty:
      return content;
    default:
      return '';
  }
}

export function filterFillData (filter: YDatabaseFilter, field: YDatabaseField) {
  const content = filter.get(YjsDatabaseKey.content);
  const condition = Number(filter.get(YjsDatabaseKey.condition));

  const fieldType = Number(field.get(YjsDatabaseKey.type));

  switch (fieldType) {
    case FieldType.URL:
    case FieldType.RichText:
      return textFilterFillData(content, condition);
    case FieldType.Number:
      return numberFilterFillData(content, condition);
    case FieldType.Checkbox:
      return checkboxFilterFillData(condition);
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
      return selectOptionFilterFillData(content, condition);
    case FieldType.Checklist:
      return checklistFilterFillData(content, condition);
    default:
      return null;
  }
}

export function getDefaultFilterCondition (fieldType: FieldType) {
  switch (fieldType) {
    case FieldType.RichText:
    case FieldType.URL:
      return {
        condition: TextFilterCondition.TextContains,
        content: '',
      };
    case FieldType.Checkbox:
      return {
        condition: CheckboxFilterCondition.IsChecked,
      };
    case FieldType.Checklist:
      return {
        condition: ChecklistFilterCondition.IsIncomplete,
      };
    case FieldType.SingleSelect:
      return {
        condition: SelectOptionFilterCondition.OptionIs,
        content: '',
      };
    case FieldType.MultiSelect:
      return {
        condition: SelectOptionFilterCondition.OptionContains,
        content: '',
      };
    case FieldType.Number:
      return {
        condition: NumberFilterCondition.Equal,
        value: '',
      };
    case FieldType.DateTime:
    case FieldType.CreatedTime:
    case FieldType.LastEditedTime:
      return {
        condition: DateFilterCondition.DateStartsOn,
        content: JSON.stringify({
          timestamp: dayjs().startOf('day').unix(),
        }),
      };
  }
}