import { nanoid } from 'nanoid';
import { createContext, useContext } from 'react';

import { Filter, FieldType, FilterType } from '@/application/database-yjs/database.type';
import {
  getDefaultFilterCondition,
  normalizeFilterNode,
  parseFilter,
  resolveRollupFilterTargetFieldType,
} from '@/application/database-yjs/filter';
import { newRollupFilterMetadata } from '@/application/database-yjs/rollup/filter';
import { YDatabaseFields, YDatabaseFilters, YjsDatabaseKey } from '@/application/types';

import { applyFilterUpdate, UpdateFilterParams } from './filter-update';

/**
 * A filter rule held outside the document, keyed exactly like the view's
 * stored filters (`id`, `field_id`, `ty`, `filter_type`, `condition`,
 * `content`), so the view's parser, predicates and update rules apply as-is.
 */
export type DetachedFilter = Record<string, unknown>;

/**
 * Desktop's `FilterEditorBloc.inMemory`: a flat AND list owned by one surface
 * (the chart row popup). While a store is provided, the filter dispatch hooks
 * write to it instead of the view, so the existing filter chips and editors
 * can edit rules that never reach the document.
 */
export interface DetachedFilterStore {
  /** Adds the field's default rule, like `useAddFilter`, and returns its id. */
  addFilter: (fieldId: string) => string | undefined;
  updateFilter: (params: UpdateFilterParams) => void;
  removeFilter: (filterId: string) => void;
}

export const DetachedFilterStoreContext = createContext<DetachedFilterStore | null>(null);

export function useDetachedFilterStore() {
  return useContext(DetachedFilterStoreContext);
}

/** The rule `useAddFilter` would store for the field, or null for a field without filters. */
export function createDetachedFilter(
  fieldId: string,
  fields: YDatabaseFields,
  id: string = nanoid(6)
): DetachedFilter | null {
  const field = fields.get(fieldId);

  if (!field) return null;

  const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;
  const conditionData = getDefaultFilterCondition(fieldType, field);

  if (!conditionData) return null;

  const filter: DetachedFilter = {
    [YjsDatabaseKey.id]: id,
    [YjsDatabaseKey.field_id]: fieldId,
    [YjsDatabaseKey.condition]: conditionData.condition,
    [YjsDatabaseKey.type]: fieldType,
    [YjsDatabaseKey.filter_type]: FilterType.Data,
  };

  if (conditionData.content !== undefined) filter[YjsDatabaseKey.content] = conditionData.content;

  const rollupTargetFieldType = resolveRollupFilterTargetFieldType(fieldType, field);

  if (rollupTargetFieldType !== undefined) {
    filter[YjsDatabaseKey.rollup_target_type] = rollupTargetFieldType;
    if (fieldType === FieldType.Rollup) filter[YjsDatabaseKey.rollup_meta] = newRollupFilterMetadata(field);
  }

  return filter;
}

/** Read-only view of a rule list as the Y.Array the filter helpers expect. */
export function asYDatabaseFilters(filters: readonly DetachedFilter[]): YDatabaseFilters {
  return {
    length: filters.length,
    toArray: () => [...filters],
    get: (index: number) => filters[index],
  } as unknown as YDatabaseFilters;
}

/** Applies an editor's patch with the view's own rules (`applyFilterUpdate`). */
export function updateDetachedFilters(
  filters: readonly DetachedFilter[],
  fields: YDatabaseFields,
  params: UpdateFilterParams
): DetachedFilter[] {
  const next = [...filters];
  const array = {
    toArray: () => [...next],
    delete: (index: number) => {
      next.splice(index, 1);
    },
    insert: (index: number, items: DetachedFilter[]) => {
      next.splice(index, 0, ...items);
    },
  } as unknown as YDatabaseFilters;

  applyFilterUpdate(array, fields, params);
  return next;
}

/**
 * Whether the rule still applies to its field: desktop drops a session rule
 * once its field is deleted or changes type.
 */
export function isDetachedFilterCurrent(filter: DetachedFilter, fields: YDatabaseFields) {
  const field = fields.get(String(filter[YjsDatabaseKey.field_id]));

  return field !== undefined && Number(field.get(YjsDatabaseKey.type)) === Number(filter[YjsDatabaseKey.type]);
}

/** The rule as the filter chips and editors read it (`useFilterSelector`'s parse). */
export function parseDetachedFilter(filter: DetachedFilter, fields: YDatabaseFields): Filter | null {
  const node = normalizeFilterNode(filter);
  const field = fields.get(String(filter[YjsDatabaseKey.field_id]));

  if (!node || !field) return null;

  return parseFilter(Number(field.get(YjsDatabaseKey.type)) as FieldType, node, fields);
}
