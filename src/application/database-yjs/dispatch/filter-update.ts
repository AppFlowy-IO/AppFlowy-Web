import { YDatabaseFields, YDatabaseFilter, YDatabaseFilters, YjsDatabaseKey as K } from '@/application/types';

import { FieldType } from '../database.type';
import { RollupFilterMetadata } from '../fields/rollup/rollup.type';
import { newRollupFilterMetadata, parseRollupFilterMetadata, rollupConfigurationMatches } from '../rollup/filter';

export interface UpdateFilterParams {
  filterId: string;
  fieldId?: string;
  condition?: number;
  content?: string;
  transformContent?: (current: string) => string;
  rollupMetadata?: RollupFilterMetadata;
  rollupTargetFieldType?: FieldType;
  expectedRollupMetadata?: RollupFilterMetadata;
}

/** Patch one rule without flattening groups or replacing unrelated CRDT nodes. */
export function applyFilterUpdate(filters: YDatabaseFilters, fields: YDatabaseFields, params: UpdateFilterParams) {
  const visit = (node: unknown): unknown => {
    if (!node || typeof node !== 'object') return node;
    const map = typeof (node as YDatabaseFilter).get === 'function' ? (node as YDatabaseFilter) : undefined;
    const obj = map ? undefined : (node as Record<string, unknown>);
    const get = (key: K) => (map ? map.get(key as K.id) : obj![key]);

    if (get(K.id) === params.filterId) {
      const fieldId = String(get(K.field_id));

      if (params.fieldId && fieldId !== params.fieldId) return node;
      const metadata = parseRollupFilterMetadata(get(K.rollup_meta));
      const field = fields.get(fieldId);

      if (!rollupConfigurationMatches(metadata, params.expectedRollupMetadata)) return node;
      if (
        params.expectedRollupMetadata &&
        field &&
        !rollupConfigurationMatches(newRollupFilterMetadata(field), params.expectedRollupMetadata)
      )
        return node;
      const updates: Record<string, unknown> = {};

      if (params.condition !== undefined) updates[K.condition] = params.condition;
      if (params.content !== undefined) updates[K.content] = params.content;
      if (params.transformContent) updates[K.content] = params.transformContent(String(get(K.content) ?? ''));
      if (params.rollupMetadata !== undefined) updates[K.rollup_meta] = { ...metadata, ...params.rollupMetadata };
      if (params.rollupTargetFieldType !== undefined) updates[K.rollup_target_type] = params.rollupTargetFieldType;
      if (!map) return { ...obj, ...updates };
      Object.entries(updates).forEach(([key, value]) => map.set(key, value));
      return node;
    }

    const children = get(K.children);

    if (Array.isArray(children)) {
      const updated = children.map(visit);

      if (updated.some((child, i) => child !== children[i])) {
        if (!map) return { ...obj, [K.children]: updated };
        map.set(K.children, updated);
      }
    } else if (children && typeof (children as YDatabaseFilters).toArray === 'function') {
      patchArray(children as YDatabaseFilters);
    }

    return node;
  };

  const patchArray = (array: YDatabaseFilters) =>
    array.toArray().forEach((node, i) => {
      const updated = visit(node);

      if (updated !== node) {
        array.delete(i);
        array.insert(i, [updated as YDatabaseFilter]);
      }
    });

  patchArray(filters);
}

export function toggleFilterId(content: string, id: string, json = true, selected?: boolean) {
  let ids: string[] = [];

  if (json) {
    try {
      const parsed = JSON.parse(content || '[]');

      if (Array.isArray(parsed)) ids = parsed.filter((value): value is string => typeof value === 'string');
    } catch {
      /* Invalid legacy content starts as an empty selection. */
    }
  } else ids = content.split(',').filter(Boolean);
  const add = selected ?? !ids.includes(id);
  const next = add ? [...new Set([...ids, id])] : ids.filter((value) => value !== id);

  return json ? JSON.stringify(next) : next.join(',');
}
