import dayjs from 'dayjs';
import { every, filter, some } from 'lodash-es';

import { DateTimeCell } from '@/application/database-yjs/cell.type';
import {
  getConditionCellData,
  getConditionCellText,
  getConditionDateCell,
  getRowConditionSnapshot,
} from '@/application/database-yjs/condition-value-cache';
import { FieldType, FilterType } from '@/application/database-yjs/database.type';
import {
  CheckboxFilter,
  CheckboxFilterCondition,
  ChecklistFilter,
  ChecklistFilterCondition,
  DateFilter,
  DateFilterCondition,
  isRelativeDateCondition,
  NumberFilter,
  NumberFilterCondition,
  parseChecklistFlexible,
  parseSelectOptionTypeOptions,
  PersonFilterCondition,
  RelationFilterCondition,
  resolveRelativeDates,
  SelectOptionFilter,
  SelectOptionFilterCondition,
  TextFilter,
  TextFilterCondition,
} from '@/application/database-yjs/fields';
import { EnhancedBigStats } from '@/application/database-yjs/fields/number/EnhancedBigStats';
import { parseCheckboxValue } from '@/application/database-yjs/fields/text/utils';
import { isNumericRollupField } from '@/application/database-yjs/rollup/utils';
import { Row } from '@/application/database-yjs/selector';
import {
  RowId,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFilter,
  YDatabaseFilters,
  YDoc,
  YjsDatabaseKey,
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
    case FieldType.Relation:
    case FieldType.Rollup:
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
        const userIds = JSON.parse(value.content) as string[];

        return {
          ...value,
          userIds,
        };
      } catch (e) {
        console.error('Error parsing person filter content:', e);
        return {
          ...value,
          userIds: [],
        };
      }
  }

  return value;
}

function wrapPlainObjectAsFilter(obj: Record<string, unknown>): YDatabaseFilter {
  return {
    get: (key: string) => obj[key],
  } as unknown as YDatabaseFilter;
}

function normalizeFilterNode(node: unknown): YDatabaseFilter | null {
  if (node === null || typeof node !== 'object') return null;

  // Already a Yjs Map with .get()
  if (typeof (node as YDatabaseFilter).get === 'function') {
    return node as YDatabaseFilter;
  }

  // Plain object from desktop sync -- wrap it
  return wrapPlainObjectAsFilter(node as Record<string, unknown>);
}

function getFilterChildren(filter: YDatabaseFilter): YDatabaseFilter[] {
  const children = filter.get(YjsDatabaseKey.children);

  if (!children) return [];

  let childArray: unknown[];

  if (Array.isArray(children)) {
    childArray = children;
  } else if (typeof (children as { toArray?: () => unknown[] }).toArray === 'function') {
    childArray = (children as { toArray: () => unknown[] }).toArray();
  } else {
    return [];
  }

  return childArray
    .map(normalizeFilterNode)
    .filter((node): node is YDatabaseFilter => node !== null);
}

function parseRelationFilterIds(content: string): string[] | null {
  const trimmed = content.trim();

  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);

    if (Array.isArray(parsed)) {
      return parsed.map((id) => String(id)).filter(Boolean);
    }
  } catch (e) {
    return null;
  }

  return null;
}

export function relationFilterFillData(content: string, condition: number): RowId[] | null {
  const normalized = normalizeRelationCondition(condition);

  if (normalized !== RelationFilterCondition.RelationContains) {
    return null;
  }

  return parseRelationFilterIds(content) ?? null;
}

function getRelationRowIds(cellData: unknown): string[] {
  if (!cellData) return [];

  if (typeof cellData === 'object' && 'toJSON' in cellData) {
    const json = (cellData as { toJSON: () => unknown }).toJSON();

    if (Array.isArray(json)) {
      return json.map((id) => String(id)).filter(Boolean);
    }
  }

  if (Array.isArray(cellData)) {
    return cellData.map((id) => String(id)).filter(Boolean);
  }

  if (typeof cellData === 'string') {
    try {
      const parsed = JSON.parse(cellData);

      if (Array.isArray(parsed)) {
        return parsed.map((id) => String(id)).filter(Boolean);
      }
    } catch (e) {
      return cellData
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    }
  }

  return [];
}

function normalizeRelationCondition(condition: number): RelationFilterCondition | null {
  switch (condition) {
    case RelationFilterCondition.RelationIsEmpty:
    case RelationFilterCondition.RelationIsNotEmpty:
    case RelationFilterCondition.RelationContains:
    case RelationFilterCondition.RelationDoesNotContain:
      return condition;
    case RelationFilterCondition.RelationLegacyTextIsEmpty:
      return RelationFilterCondition.RelationIsEmpty;
    case RelationFilterCondition.RelationLegacyTextIsNotEmpty:
      return RelationFilterCondition.RelationIsNotEmpty;
    default:
      return null;
  }
}

export function relationFilterCheck(cellData: unknown, filterRowIds: string[], condition: number) {
  const normalized = normalizeRelationCondition(condition);

  if (normalized === null) return true;

  const cellRowIds = getRelationRowIds(cellData);

  switch (normalized) {
    case RelationFilterCondition.RelationIsEmpty:
      return cellRowIds.length === 0;
    case RelationFilterCondition.RelationIsNotEmpty:
      return cellRowIds.length > 0;
    case RelationFilterCondition.RelationContains:
      if (filterRowIds.length === 0) return true;
      return some(filterRowIds, (rowId) => cellRowIds.includes(rowId));
    case RelationFilterCondition.RelationDoesNotContain:
      if (filterRowIds.length === 0) return true;
      return every(filterRowIds, (rowId) => !cellRowIds.includes(rowId));
    default:
      return true;
  }
}

// ============================================================================
// Tree utility types and functions for per-row operator support
// ============================================================================

export interface FilterDraft {
  id: string;
  fieldId: string;
  fieldType: number;
  condition: number;
  content: string;
  operator: FilterType.And | FilterType.Or | null;
}

/**
 * Recursively flatten a filter tree into a flat list with per-row operators.
 * Mirrors the desktop's `collectFilters()` logic from `filter_entities.dart`.
 */
export function flattenFilterTree(
  filtersArray: YDatabaseFilters,
  fields: YDatabaseFields
): FilterDraft[] {
  const result: FilterDraft[] = [];

  if (!filtersArray || filtersArray.length === 0) return result;

  const rootFilter = filtersArray.get(0);

  if (!rootFilter) return result;

  const rootNode = typeof rootFilter.get === 'function'
    ? rootFilter
    : wrapPlainObjectAsFilter(rootFilter as unknown as Record<string, unknown>);

  const rootType = Number(rootNode.get(YjsDatabaseKey.filter_type));

  if (rootType !== FilterType.And && rootType !== FilterType.Or) {
    // Not in advanced mode - single flat data filter
    return result;
  }

  const rootOperator = rootType; // Already narrowed to And | Or by the guard above
  const children = getFilterChildren(rootNode);

  for (let i = 0; i < children.length; i++) {
    collectFiltersRecursive(
      children[i],
      i === 0 ? null : rootOperator,
      fields,
      result
    );
  }

  // Also collect any sibling top-level filters at indices 1+ (can appear from
  // concurrent desktop sync adding flat filters while web is in advanced mode).
  // filterBy() combines top-level entries with AND, so siblings always get And.
  for (let i = 1; i < filtersArray.length; i++) {
    const sibling = filtersArray.get(i);

    if (!sibling) continue;

    // Siblings are always AND'd with the root group by filterBy().
    collectFiltersRecursive(
      sibling,
      FilterType.And,
      fields,
      result
    );
  }

  return result;
}

function collectFiltersRecursive(
  filterNode: YDatabaseFilter,
  inheritedOperator: FilterType.And | FilterType.Or | null,
  fields: YDatabaseFields,
  result: FilterDraft[]
): void {
  const node = typeof filterNode.get === 'function'
    ? filterNode
    : wrapPlainObjectAsFilter(filterNode as unknown as Record<string, unknown>);

  const filterType = Number(node.get(YjsDatabaseKey.filter_type));

  if (filterType === FilterType.And || filterType === FilterType.Or) {
    const groupOperator = filterType; // Already narrowed to And | Or by the guard above
    const children = getFilterChildren(node);

    for (let i = 0; i < children.length; i++) {
      collectFiltersRecursive(
        children[i],
        i === 0 ? inheritedOperator : groupOperator,
        fields,
        result
      );
    }

    return;
  }

  // Data filter - extract as draft
  const fieldId = node.get(YjsDatabaseKey.field_id);

  if (!fieldId) return;

  const field = fields.get(fieldId);
  let fieldTypeNum: number;

  if (field) {
    fieldTypeNum = Number(field.get(YjsDatabaseKey.type));
  } else {
    // Desktop stores field type under 'ty' key; YjsDatabaseKey.type resolves to 'ty'
    const tyValue = node.get(YjsDatabaseKey.type);

    fieldTypeNum = tyValue !== undefined ? Number(tyValue) : FieldType.RichText;
  }

  result.push({
    id: String(node.get(YjsDatabaseKey.id) ?? ''),
    fieldId,
    fieldType: fieldTypeNum,
    condition: Number(node.get(YjsDatabaseKey.condition)),
    content: String(node.get(YjsDatabaseKey.content) ?? ''),
    operator: inheritedOperator,
  });
}

/**
 * Group consecutive drafts by their operator.
 * Mirrors desktop's `_groupByConsecutiveOperator()`.
 *
 * Example: [A(null), B(Or), C(Or), D(And)] →
 *   [{ operator: Or, drafts: [A, B, C] }, { operator: And, drafts: [D] }]
 */
export function groupByConsecutiveOperator(
  drafts: FilterDraft[]
): { operator: FilterType.And | FilterType.Or; drafts: FilterDraft[] }[] {
  if (drafts.length < 2) {
    return [{ operator: FilterType.And, drafts }];
  }

  const groups: { operator: FilterType.And | FilterType.Or; drafts: FilterDraft[] }[] = [];
  let currentOperator = drafts[1].operator ?? FilterType.And;
  let currentDrafts: FilterDraft[] = [drafts[0], drafts[1]];

  for (let i = 2; i < drafts.length; i++) {
    const op = drafts[i].operator ?? FilterType.And;

    if (op === currentOperator) {
      currentDrafts.push(drafts[i]);
    } else {
      groups.push({ operator: currentOperator, drafts: currentDrafts });
      currentOperator = op;
      currentDrafts = [drafts[i]];
    }
  }

  groups.push({ operator: currentOperator, drafts: currentDrafts });

  return groups;
}

type FilterOptions = {
  getRelationCellText?: (rowId: string, fieldId: string) => string;
  getRollupCellText?: (rowId: string, fieldId: string) => string;
};

function createPredicate(conditions: ((row: Row) => boolean)[]) {
  return function (item: Row) {
    return every(conditions, (condition) => condition(item));
  };
}

export function filterBy(
  rows: Row[],
  filters: YDatabaseFilters,
  fields: YDatabaseFields,
  rowMetas: Record<RowId, YDoc>,
  options?: FilterOptions
) {
  const filterArray = filters.toArray();

  if (filterArray.length === 0 || Object.keys(rowMetas).length === 0 || fields.size === 0) return rows;

  const evaluateFilter = (filterNode: YDatabaseFilter, row: Row): boolean => {
    if (!filterNode || typeof filterNode !== 'object') {
      return true;
    }

    // Wrap plain objects that lack .get() (e.g. from desktop sync)
    const node = typeof filterNode.get === 'function'
      ? filterNode
      : wrapPlainObjectAsFilter(filterNode as unknown as Record<string, unknown>);

    const filterType = Number(node.get(YjsDatabaseKey.filter_type));

    if (filterType === FilterType.And || filterType === FilterType.Or) {
      const children = getFilterChildren(node);

      if (children.length === 0) return true;

      if (filterType === FilterType.And) {
        return every(children, (child) => evaluateFilter(child, row));
      }

      return some(children, (child) => evaluateFilter(child, row));
    }

    const fieldId = node.get(YjsDatabaseKey.field_id);
    const field = fields.get(fieldId);

    if (!field) return true;

    const fieldType = Number(field.get(YjsDatabaseKey.type));
    const rowId = row.id;
    const rowMeta = rowMetas[rowId];

    if (!rowMeta) return false;

    const filterValue = parseFilter(fieldType, node);
    const snapshot = getRowConditionSnapshot(rowMeta);

    if (!snapshot) return false;

    const cellData = getConditionCellData(snapshot, fieldId);

    const condition = Number(filterValue.condition);
    const rawContent = filterValue.content;
    const content = typeof rawContent === 'string' ? rawContent : '';

    const cellText =
      fieldType === FieldType.Relation
        ? options?.getRelationCellText?.(rowId, fieldId) ?? ''
        : fieldType === FieldType.Rollup
          ? options?.getRollupCellText?.(rowId, fieldId) ?? ''
          : getConditionCellText(snapshot, fieldId, field);

    if (fieldType === FieldType.Relation) {
      const relationRowIds = parseRelationFilterIds(content);

      if (relationRowIds !== null) {
        return relationFilterCheck(cellData, relationRowIds, condition);
      }

      // Empty content on the new relation conditions (IsEmpty / IsNotEmpty /
      // Contains / DoesNotContain) means "evaluate by relation row IDs";
      // route to relationFilterCheck so it inspects cellRowIds. Falling
      // through to textFilterCheck would either hide every row (DoesNotContain)
      // or treat rows with relation IDs but blank/deleted titles as empty.
      if (
        !content.trim() &&
        (condition === RelationFilterCondition.RelationIsEmpty ||
          condition === RelationFilterCondition.RelationIsNotEmpty ||
          condition === RelationFilterCondition.RelationContains ||
          condition === RelationFilterCondition.RelationDoesNotContain)
      ) {
        return relationFilterCheck(cellData, [], condition);
      }

      return textFilterCheck(cellText, content, condition);
    }

    switch (fieldType) {
      case FieldType.URL:
      case FieldType.RichText:
        return textFilterCheck(cellText, content, condition);
      case FieldType.Rollup:
        // Numeric rollups compare the calculated number; non-numeric rollups
        // fall back to text matching against the joined-value rendering.
        return isNumericRollupField(field)
          ? numberFilterCheck(cellText, content, condition)
          : textFilterCheck(cellText, content, condition);
      case FieldType.Time:
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
        return dateFilterCheck(getConditionDateCell(snapshot, fieldId), filterValue as DateFilter);
      case FieldType.CreatedTime: {
        const data = snapshot.row.get(YjsDatabaseKey.created_at);

        return rowTimeFilterCheck(data, filterValue as DateFilter);
      }

      case FieldType.LastEditedTime: {
        const data = snapshot.row.get(YjsDatabaseKey.last_modified);

        return rowTimeFilterCheck(data, filterValue as DateFilter);
      }

      case FieldType.Person: {
        return personFilterCheck(typeof cellData === 'string' ? cellData : '', content, condition);
      }

      default:
        return true;
    }
  };

  const conditions = filterArray.map((filterNode) => {
    return (row: Row) => evaluateFilter(filterNode, row);
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
  if (isRelativeDateCondition(filter.condition)) {
    return relativeDateRangeMatches(data, filter);
  }

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

// Resolves a relative-date filter to a concrete [start, end] range and tests whether
// the cell's relevant timestamp (start for "DateStarts*", end for "DateEnds*") falls in it.
function relativeDateRangeMatches(data: string, filter: DateFilter, endTimestamp?: string): boolean {
  // Mirrors desktop: DateStarts* relatives match against cell.start; DateEnds* match against cell.end.
  const isEndCondition = filter.condition >= DateFilterCondition.DateEndsToday;
  const target = isEndCondition ? endTimestamp ?? '' : data;

  if (!target) return false;

  const resolved = resolveRelativeDates(filter);

  // Single-day relatives (Today/Yesterday/Tomorrow) → same-day check.
  if (resolved.timestamp !== undefined) {
    return isTimestampInSameDay(target, resolved.timestamp.toString());
  }

  if (resolved.start !== undefined && resolved.end !== undefined) {
    // resolved.end is local midnight of the last day; extend to end-of-day for inclusive matching.
    const endInclusive = resolved.end + 24 * 60 * 60 - 1;

    return isTimestampBetweenRange(target, resolved.start.toString(), endInclusive.toString());
  }

  return false;
}

export function dateFilterCheck(cell: DateTimeCell | null, filter: DateFilter) {
  const { condition, end = '', start = '', timestamp = '' } = filter;

  const { data = '', endTimestamp = '' } = cell || {};

  if (isRelativeDateCondition(condition)) {
    return relativeDateRangeMatches(data, filter, endTimestamp);
  }

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
    const trimmed = data.trim();
    const looksLikeChecklist =
      trimmed.startsWith('{') || trimmed.includes('[x]') || trimmed.includes('[X]') || trimmed.includes('[ ]');
    const checklist = looksLikeChecklist ? parseChecklistFlexible(data) : null;

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
      if (!content) return true;
      if (selectedIdsByName.length === 0) return false;
      return every(selectedIdsByName, (id) => filterOptionIds.includes(id));

    case SelectOptionFilterCondition.OptionIsNot:
      if (!content) return true;
      if (selectedIdsByName.length === 0) return true;
      return !every(selectedIdsByName, (id) => filterOptionIds.includes(id));

    case SelectOptionFilterCondition.OptionContains:
      if (!content) return true;
      if (selectedIdsByName.length === 0) return false;
      return some(filterOptionIds, (option) => selectedIdsByName.includes(option));

    case SelectOptionFilterCondition.OptionDoesNotContain:
      if (!content) return true;
      if (selectedIdsByName.length === 0) return true;
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
    return userIds.length === 0;
  }

  if (PersonFilterCondition.PersonIsNotEmpty === condition) {
    return userIds.length > 0;
  }

  switch (condition) {
    case PersonFilterCondition.PersonContains:
      if (filterIds.length === 0) return true;
      return every(filterIds, (id) => userIds.includes(id));

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

  // Relative-date conditions (Today / This week / etc.) ignore the stored
  // timestamp and always pre-fill from the resolved range so the new row
  // satisfies the filter.
  if (isRelativeDateCondition(condition)) {
    const resolved = resolveRelativeDates({
      condition,
      timestamp: undefined,
      start: undefined,
      end: undefined,
    } as DateFilter);
    const isEnd = condition >= DateFilterCondition.DateEndsToday;
    const fill = (resolved.timestamp ?? resolved.start ?? Number(today)).toString();

    return isEnd ? { data: fill, endTimestamp: fill, isRange: true } : { data: fill, isRange: false };
  }

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
    case FieldType.Relation:
      return textFilterFillData(content, condition);
    case FieldType.Number:
    case FieldType.Time:
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

export function getDefaultFilterCondition(fieldType: FieldType, field?: YDatabaseField) {
  switch (fieldType) {
    case FieldType.RichText:
    case FieldType.URL:
      return {
        condition: TextFilterCondition.TextContains,
        content: '',
      };
    case FieldType.Rollup:
      // Numeric rollups (Sum, Avg, Count, …) get number conditions; everything
      // else falls back to text conditions because the rollup renders as a
      // joined string of target values.
      return isNumericRollupField(field)
        ? { condition: NumberFilterCondition.Equal, content: '' }
        : { condition: TextFilterCondition.TextContains, content: '' };
    case FieldType.Relation:
      return {
        condition: RelationFilterCondition.RelationContains,
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
        content: '',
      };
    case FieldType.Time:
      return {
        condition: NumberFilterCondition.Equal,
        content: '',
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
