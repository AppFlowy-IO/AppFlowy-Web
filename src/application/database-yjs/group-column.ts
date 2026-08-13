import * as Y from 'yjs';

import { YjsDatabaseKey } from '@/application/types';
import type { YDatabaseGroup, YDatabaseGroupColumn } from '@/application/types';

// Local-only provenance. Never persist this bit into the collaborative map:
// remote/Desktop-created groups must not gain initialization authority merely
// because their structure matches a group Web could create.
const pendingLocalGridGroupInitializations = new WeakSet<YDatabaseGroup>();

export function markLocalGridGroupInitialization(group: YDatabaseGroup) {
  pendingLocalGridGroupInitializations.add(group);
}

export function hasPendingLocalGridGroupInitialization(group: YDatabaseGroup) {
  return pendingLocalGridGroupInitializations.has(group);
}

export function consumeLocalGridGroupInitialization(group: YDatabaseGroup) {
  return pendingLocalGridGroupInitializations.delete(group);
}

export interface DatabaseGroupColumn {
  id: string;
  visible: boolean;
  groupColor?: string;
  /** Whether `visible` was explicitly persisted rather than defaulted to true. */
  visibleExplicit: boolean;
}

function parseVisible(value: unknown) {
  return value !== false && value !== 'false';
}

export function normalizeDatabaseGroupColumn(column: unknown): DatabaseGroupColumn | null {
  if (!column || typeof column !== 'object') return null;

  if (column instanceof Y.Map) {
    const id = column.get(YjsDatabaseKey.id);

    if (typeof id !== 'string' || !id) return null;

    const rawVisible = column.get(YjsDatabaseKey.visible);
    const rawGroupColor = column.get(YjsDatabaseKey.group_color);

    return {
      id,
      visible: parseVisible(rawVisible),
      visibleExplicit: rawVisible !== undefined && rawVisible !== null,
      groupColor: typeof rawGroupColor === 'string' ? rawGroupColor : undefined,
    };
  }

  const plainColumn = column as {
    id?: unknown;
    visible?: unknown;
    group_color?: unknown;
  };

  if (typeof plainColumn.id !== 'string' || !plainColumn.id) return null;

  return {
    id: plainColumn.id,
    visible: parseVisible(plainColumn.visible),
    visibleExplicit: plainColumn.visible !== undefined && plainColumn.visible !== null,
    groupColor: typeof plainColumn.group_color === 'string' ? plainColumn.group_color : undefined,
  };
}

export function normalizeUniqueDatabaseGroupColumns(columns: readonly unknown[]): DatabaseGroupColumn[] {
  const seenIds = new Set<string>();

  return columns.reduce<DatabaseGroupColumn[]>((result, column) => {
    const normalized = normalizeDatabaseGroupColumn(column);

    if (!normalized || seenIds.has(normalized.id)) return result;

    seenIds.add(normalized.id);
    result.push(normalized);
    return result;
  }, []);
}

export function createYDatabaseGroupColumn({
  groupColor,
  id,
  visible = true,
}: {
  groupColor?: string;
  id: string;
  visible?: boolean;
}): YDatabaseGroupColumn {
  const column = new Y.Map() as YDatabaseGroupColumn;

  column.set(YjsDatabaseKey.id, id);
  column.set(YjsDatabaseKey.visible, visible);
  if (groupColor !== undefined) column.set(YjsDatabaseKey.group_color, groupColor);

  return column;
}

export function getDatabaseGroupColumnId(column: unknown): string | undefined {
  return normalizeDatabaseGroupColumn(column)?.id;
}

export function cloneYDatabaseGroupColumn(column: unknown): YDatabaseGroupColumn | null {
  const normalized = normalizeDatabaseGroupColumn(column);

  if (!normalized) return null;

  return createYDatabaseGroupColumn({
    groupColor: normalized.groupColor,
    id: normalized.id,
    visible: normalized.visible,
  });
}
