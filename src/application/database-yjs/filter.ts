import dayjs from 'dayjs';
import { every, filter, some } from 'lodash-es';

import { parseYDatabaseDateTimeCellToCell } from '@/application/database-yjs/cell.parse';
import { DateTimeCell } from '@/application/database-yjs/cell.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { decodeCellToText } from '@/application/database-yjs/decode';
import {
  CheckboxFilter,
  CheckboxFilterCondition,
  ChecklistFilter,
  ChecklistFilterCondition,
  DateFilter,
  DateFilterCondition,
  NumberFilter,
  NumberFilterCondition,
  parseChecklistFlexible,
  parseSelectOptionTypeOptions,
  PersonFilterCondition,
  SelectOptionFilter,
  SelectOptionFilterCondition,
  TextFilter,
  TextFilterCondition,
} from '@/application/database-yjs/fields';
import { EnhancedBigStats } from '@/application/database-yjs/fields/number/EnhancedBigStats';
import { parseCheckboxValue } from '@/application/database-yjs/fields/text/utils';
import { Row } from '@/application/database-yjs/selector';
import {
  RowId,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { isAfterOneDay, isTimestampBefore, isTimestampBetweenRange, isTimestampInSameDay } from '@/utils/time';

export function parseFilter(fieldType: FieldType, filter: YDatabaseFilter) {
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

    case FieldType.Person:
      try {
        const personIds = JSON.parse(value.content) as string[];

        return {
          ...value,
          personIds,
        };
      } catch (e) {
        console.error('Error parsing person filter content:', e);
        return {
          ...value,
          personIds: [],
        };
      }
  }

  return value;
}

function createPredicate(conditions: ((row: Row) => boolean)[]) {
  return function (item: Row) {
    return every(conditions, (condition) => condition(item));
  };
}

export function filterBy(
  rows: Row[],
  filters: YDatabaseFilters,
  fields: YDatabaseFields,
  rowMetas: Record<RowId, YDoc>
) {
  const filterArray = filters.toArray();

  if (filterArray.length === 0 || Object.keys(rowMetas).length === 0 || fields.size === 0) return rows;

  const conditions = filterArray.map((filter) => {
    return (row: { id: string }) => {
      const fieldId = filter.get(YjsDatabaseKey.field_id);
      const field = fields.get(fieldId);

      if (!field) return true;
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

      const cellData = cell?.get(YjsDatabaseKey.data);
      const cellText = cell ? decodeCellToText(cell, field) : '';

      switch (fieldType) {
        case FieldType.URL:
        case FieldType.RichText:
        case FieldType.Time:
          return textFilterCheck(cellText, content, condition);
        case FieldType.Number:
          return numberFilterCheck(cellText, content, condition);
        case FieldType.Checkbox:
          return checkboxFilterCheck(cellData, condition);
        case FieldType.SingleSelect:
        case FieldType.MultiSelect:
          return selectOptionFilterCheck(field, cellData, content, condition);
        case FieldType.Checklist:
          return checklistFilterCheck(cellData as string, content, condition);
        case FieldType.DateTime:
          return dateFilterCheck(cell ? parseYDatabaseDateTimeCellToCell(cell) : null, filterValue as DateFilter);
        case FieldType.CreatedTime: {
          const data = meta.get(YjsDatabaseKey.created_at);

          return rowTimeFilterCheck(data, filterValue as DateFilter);
        }

        case FieldType.LastEditedTime: {
          const data = meta.get(YjsDatabaseKey.last_modified);

          return rowTimeFilterCheck(data, filterValue as DateFilter);
        }

        case FieldType.Person: {
          return personFilterCheck(typeof cellData === 'string' ? cellData : '', content, condition);
        }

        default:
          return true;
      }
    };
  });
  const predicate = createPredicate(conditions);

  return filter(rows, predicate);
}

export function textFilterCheck(data: string, content: string, condition: TextFilterCondition) {
  switch (condition) {
    case TextFilterCondition.TextContains:
      return data.toLocaleLowerCase().includes(content.toLocaleLowerCase());
    case TextFilterCondition.TextDoesNotContain:
      return !data.toLocaleLowerCase().includes(content.toLocaleLowerCase());
    case TextFilterCondition.TextIs:
      return data === content;
    case TextFilterCondition.TextIsNot:
      return data !== content;
    case TextFilterCondition.TextIsEmpty:
      return data === '';
    case TextFilterCondition.TextIsNotEmpty:
      return data !== '';
    case TextFilterCondition.TextEndsWith:
      return data.toLocaleLowerCase().endsWith(content.toLocaleLowerCase());
    case TextFilterCondition.TextStartsWith:
      return data.toLocaleLowerCase().startsWith(content.toLocaleLowerCase());
    default:
      return false;
  }
}

export function numberFilterCheck(data: string, content: string, condition: number) {
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

export function checkboxFilterCheck(data: unknown, condition: number) {
  switch (condition) {
    case CheckboxFilterCondition.IsChecked:
      return parseCheckboxValue(data as string);
    case CheckboxFilterCondition.IsUnChecked:
      return !parseCheckboxValue(data as string);
    default:
      return false;
  }
}

export function checklistFilterCheck(data: unknown, content: string, condition: number) {
  const percentage = typeof data === 'string' ? parseChecklistFlexible(data)?.percentage ?? 0 : 0;

  if (condition === ChecklistFilterCondition.IsComplete) {
    return percentage === 1;
  }

  return percentage !== 1;
}

export function rowTimeFilterCheck(data: string, filter: DateFilter) {
  const { condition, end = '', start = '', timestamp = '' } = filter;

  switch (condition) {
    case DateFilterCondition.DateStartIsEmpty:
      return !data;
    case DateFilterCondition.DateStartIsNotEmpty:
      return !!data;
    case DateFilterCondition.DateStartsOn:
      return isTimestampInSameDay(data, timestamp.toString());
    case DateFilterCondition.DateStartsBefore:
      if (!data) return false;
      return isTimestampBefore(data, timestamp.toString());
    case DateFilterCondition.DateStartsAfter:
      if (!data) return false;
      return isAfterOneDay(data, timestamp.toString());
    case DateFilterCondition.DateStartsOnOrBefore:
      if (!data) return false;
      return isTimestampBefore(data, timestamp.toString()) || isTimestampInSameDay(data, timestamp.toString());
    case DateFilterCondition.DateStartsOnOrAfter:
      if (!data) return false;
      return isTimestampBefore(timestamp.toString(), data) || isTimestampInSameDay(timestamp.toString(), data);
    case DateFilterCondition.DateStartsBetween:
      if (!data) return false;
      return isTimestampBetweenRange(data, start.toString(), end.toString());
    default:
      return false;
  }
}

export function dateFilterCheck(cell: DateTimeCell | null, filter: DateFilter) {
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
      if (!data) return false;
      return isTimestampBefore(data, timestamp.toString());
    case DateFilterCondition.DateEndsBefore:
      if (!data) return false;
      return isTimestampBefore(endTimestamp, timestamp.toString());
    case DateFilterCondition.DateStartsAfter:
      if (!data) return false;
      return isAfterOneDay(data, timestamp.toString());
    case DateFilterCondition.DateEndsAfter:
      if (!data) return false;
      return isAfterOneDay(endTimestamp, timestamp.toString());
    case DateFilterCondition.DateStartsOnOrBefore:
      if (!data) return false;
      return isTimestampBefore(data, timestamp.toString()) || isTimestampInSameDay(data, timestamp.toString());
    case DateFilterCondition.DateEndsOnOrBefore:
      if (!data) return false;
      return (
        isTimestampBefore(endTimestamp, timestamp.toString()) || isTimestampInSameDay(endTimestamp, timestamp.toString())
      );
    case DateFilterCondition.DateStartsOnOrAfter:
      if (!data) return false;
      return isTimestampBefore(timestamp.toString(), data) || isTimestampInSameDay(timestamp.toString(), data);
    case DateFilterCondition.DateEndsOnOrAfter:
      if (!data) return false;
      return (
        isTimestampBefore(timestamp.toString(), endTimestamp) || isTimestampInSameDay(timestamp.toString(), endTimestamp)
      );
    case DateFilterCondition.DateStartsBetween:
      if (!data) return false;
      return isTimestampBetweenRange(data, start.toString(), end.toString());
    case DateFilterCondition.DateEndsBetween:
      if (!data) return false;
      return isTimestampBetweenRange(endTimestamp, start.toString(), end.toString());
    default:
      return false;
  }
}

export function selectOptionFilterCheck(field: YDatabaseField, data: unknown, content: string, condition: number) {
  const filterOptionIds = content.split(',').filter((item) => item.trim() !== '');
  const typeOption = parseSelectOptionTypeOptions(field);
  const options = typeOption?.options || [];

  let selectedOptionIds: string[] = [];

  if (typeof data === 'string') {
    const checklist = parseChecklistFlexible(data);

    if (checklist) {
      const checkedNames =
        checklist.selectedOptionIds
          ?.map((idOrName) => {
            const fromChecklist = checklist.options?.find((opt) => opt.id === idOrName)?.name;

            return fromChecklist ?? idOrName;
          })
          .filter(Boolean) ?? [];

      selectedOptionIds =
        checkedNames
          .map((idOrName) => options.find((opt) => opt.id === idOrName || opt.name === idOrName)?.id)
          .filter((item): item is string => Boolean(item)) ?? [];
    } else {
      selectedOptionIds = data
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  const selectedIdsByName = selectedOptionIds
    .map((idOrName) => options.find((opt) => opt.id === idOrName || opt.name === idOrName)?.id)
    .filter((item): item is string => Boolean(item));

  if (SelectOptionFilterCondition.OptionIsEmpty === condition) {
    return selectedIdsByName.length === 0;
  }

  if (SelectOptionFilterCondition.OptionIsNotEmpty === condition) {
    return selectedIdsByName.length > 0;
  }

  switch (condition) {
    case SelectOptionFilterCondition.OptionIs:
    case SelectOptionFilterCondition.OptionContains:
      if (!content) return true;
      return some(filterOptionIds, (option) => selectedIdsByName.includes(option));

    case SelectOptionFilterCondition.OptionIsNot:
    case SelectOptionFilterCondition.OptionDoesNotContain:
      if (!content) return true;
      return every(filterOptionIds, (option) => !selectedIdsByName.includes(option));

    default:
      return false;
  }
}


export function personFilterCheck(data: string, content: string, condition: number) {
  let userIds: string[] = [];
  let filterIds: string[] = [];

  try {
    userIds = JSON.parse(data || '[]');
    filterIds = JSON.parse(content || '[]');
  } catch (e) {
    console.error('Error parsing person filter data:', e);
    return false;
  }

  if (PersonFilterCondition.PersonIsEmpty === condition) {
    return filterIds.length === 0 || data === '';
  }

  if (PersonFilterCondition.PersonIsNotEmpty === condition) {
    return filterIds.length > 0 && data !== '';
  }

  switch (condition) {
    case PersonFilterCondition.PersonContains:
      if (filterIds.length === 0) return true;
      return some(filterIds, (id) => userIds.includes(id));

    case PersonFilterCondition.PersonDoesNotContain:
      if (filterIds.length === 0) return true;
      return every(filterIds, (id) => !userIds.includes(id));

    // Default case, if no conditions match
    default:
      return false;
  }
}

// Return the default value for the filter
export function textFilterFillData(content: string, condition: number) {
  switch (condition) {
    case TextFilterCondition.TextContains:
    case TextFilterCondition.TextStartsWith:
    case TextFilterCondition.TextEndsWith:
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

export function numberFilterFillData(content: string, condition: number) {
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

export function checkboxFilterFillData(condition: number) {
  switch (condition) {
    case CheckboxFilterCondition.IsChecked:
      return 'Yes';
    case CheckboxFilterCondition.IsUnChecked:
      return 'No';
    default:
      return '';
  }
}

export function checklistFilterFillData(content: string, condition: number) {
  switch (condition) {
    case ChecklistFilterCondition.IsComplete:
      return JSON.stringify({
        options: [
          {
            id: '1',
            name: 'Todo',
          },
        ],
        selected_option_ids: ['1'],
      });
    default:
      return '';
  }
}

export function selectOptionFilterFillData(content: string, condition: number) {
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

export function dateFilterFillData(filter: YDatabaseFilter): {
  data: string;
  endTimestamp?: string;
  includeTime?: boolean;
  isRange?: boolean;
} {
  const content = filter.get(YjsDatabaseKey.content);
  const condition = Number(filter.get(YjsDatabaseKey.condition));
  const today = dayjs().startOf('day').unix().toString();

  try {
    const {
      timestamp = today,
      start = '',
      end = '',
    } = (JSON.parse(content) as {
      timestamp?: string;
      start?: string;
      end?: string;
    }) || {};

    const beforeTimestamp = dayjs.unix(Number(timestamp)).subtract(1, 'day').startOf('day').unix().toString();
    const afterTimestamp = dayjs.unix(Number(timestamp)).add(1, 'day').startOf('day').unix().toString();

    switch (condition) {
      case DateFilterCondition.DateStartsOn:
        return {
          data: timestamp,
          isRange: false,
        };
      case DateFilterCondition.DateEndsOn:
        return {
          data: timestamp,
          endTimestamp: timestamp,
          isRange: true,
        };
      case DateFilterCondition.DateStartsBefore:
        return {
          data: beforeTimestamp,
          isRange: false,
        };
      case DateFilterCondition.DateEndsBefore:
        return {
          data: beforeTimestamp,
          endTimestamp: beforeTimestamp,
          isRange: true,
        };
      case DateFilterCondition.DateStartsAfter:
        return {
          data: afterTimestamp,
          isRange: false,
        };
      case DateFilterCondition.DateEndsAfter:
        return {
          data: afterTimestamp,
          endTimestamp: afterTimestamp,
          isRange: true,
        };
      case DateFilterCondition.DateStartsOnOrBefore:
        return {
          data: timestamp,
          isRange: false,
        };
      case DateFilterCondition.DateEndsOnOrBefore:
        return {
          data: timestamp,
          endTimestamp: timestamp,
          isRange: true,
        };
      case DateFilterCondition.DateStartsOnOrAfter:
        return {
          data: afterTimestamp,
          isRange: false,
        };
      case DateFilterCondition.DateEndsOnOrAfter:
        return {
          data: afterTimestamp,
          endTimestamp: afterTimestamp,
          isRange: true,
        };
      case DateFilterCondition.DateStartsBetween:
        return {
          data: start || today,
          isRange: false,
        };
      case DateFilterCondition.DateEndsBetween:
        return {
          data: start || today,
          endTimestamp: end || today,
          isRange: true,
        };
      case DateFilterCondition.DateStartIsEmpty:
      case DateFilterCondition.DateEndIsEmpty:
        return {
          data: '',
          isRange: false,
        };
      case DateFilterCondition.DateStartIsNotEmpty:
      case DateFilterCondition.DateEndIsNotEmpty:
        return {
          data: today,
          endTimestamp: today,
          isRange: true,
        };
      default:
        return {
          data: today,
          isRange: false,
        };
    }
  } catch (e) {
    console.error('Error parsing date filter content:', e);
    return {
      data: today,
      isRange: false,
    };
  }
}

export function personFilterFillData(content: string, condition: number) {
  switch (condition) {
    case PersonFilterCondition.PersonContains:
      return content;
    case PersonFilterCondition.PersonDoesNotContain:
      return '';
    case PersonFilterCondition.PersonIsEmpty:
      return '';
    case PersonFilterCondition.PersonIsNotEmpty:
      return content;
    default:
      return '';
  }
}

export function filterFillData(filter: YDatabaseFilter, field: YDatabaseField) {
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
    case FieldType.Person:
      return personFilterFillData(content, condition);
    default:
      return null;
  }
}

export function getDefaultFilterCondition(fieldType: FieldType) {
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
    case FieldType.Person:
      return {
        condition: PersonFilterCondition.PersonContains,
        content: '',
      };
  }
}
