/**
 * Formula values that live outside the row document: member names, related
 * row titles and rollup results. Cells, the editor preview, filters, sorts,
 * footers and type conversion all read them through a
 * `ReadFieldValueContext` built here.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { useDatabase, useDatabaseContext } from '@/application/database-yjs/context';
import {
  FormulaExternalReferences,
  formulaExternalReferencesKey,
  ReadFieldValueContext,
} from '@/application/database-yjs/fields/formula';
import { useFormulaClock } from '@/application/database-yjs/formula/clock';
import { useRollupFieldObservers } from '@/application/database-yjs/hooks/useRollupFieldObservers';
import {
  ensureRelationGroupLabel,
  readRelationGroupLabel,
  retainRelationGroupLabels,
  subscribeRelationGroupLabel,
} from '@/application/database-yjs/relation/cache';
import { getRelationRowIdsFromCell } from '@/application/database-yjs/relation/cell';
import {
  invalidateRollupCell,
  readRollupCell,
  readRollupCellSync,
  RollupCellValue,
  subscribeRollupCell,
} from '@/application/database-yjs/rollup/cache';
import {
  LoadViewOptions,
  MentionablePerson,
  YDatabase,
  YDatabaseField,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
} from '@/application/types';
import { canonicalizeUserUid } from '@/application/user-uid';
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';

type RelatedViewLoader = (
  viewId: string,
  isSubDocument?: boolean,
  loadAwareness?: boolean,
  options?: LoadViewOptions
) => Promise<YDoc | null>;

export interface RelatedRowLoaders {
  loadView?: RelatedViewLoader;
  createRow?: (rowKey: string) => Promise<YDoc>;
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;
}

export interface MemberNames {
  getUserName: (uid: string) => string | undefined;
  getPersonName: (personId: string) => string | undefined;
}

/** Name lookups over a workspace member list (name, else email). */
export function memberNames(users: readonly MentionablePerson[]): MemberNames {
  const byUid = new Map<string, string>();
  const byPersonId = new Map<string, string>();

  users.forEach((user) => {
    const name = user.name?.trim() || user.email?.trim();

    if (!name) return;
    const uid = canonicalizeUserUid(user.uid);

    if (uid !== null) byUid.set(uid, name);
    if (user.person_id) byPersonId.set(user.person_id, name);
  });

  return {
    getUserName: (uid) => byUid.get(canonicalizeUserUid(uid) ?? uid),
    getPersonName: (personId) => byPersonId.get(personId),
  };
}

/**
 * Title of a related row from the shared label cache. A missing title starts
 * one bounded lookup; its result is published on the group-label channel.
 */
export function relatedRowTitle(
  relationField: YDatabaseField,
  relatedRowId: string,
  loaders: RelatedRowLoaders
): string | undefined {
  const title = readRelationGroupLabel({ relationField, relatedRowId });

  if (!title) ensureRelationGroupLabel({ relationField, relatedRowId, ...loaders });
  return title || undefined;
}

/**
 * Context for evaluating formulas outside React (filters, sorts, footers).
 * `getRollupValue` reads the rollup cache for the given row.
 */
export function formulaConditionContext(
  rowId: string,
  options: {
    members?: MemberNames;
    loaders: RelatedRowLoaders;
    getRollupValue?: (rowId: string, fieldId: string) => RollupCellValue | undefined;
  }
): ReadFieldValueContext {
  const { members, loaders, getRollupValue } = options;

  return {
    getUserName: members?.getUserName,
    getPersonName: members?.getPersonName,
    getRelatedRowTitle: (relationField, relatedRowId) => relatedRowTitle(relationField, relatedRowId, loaders),
    getRollupValue: getRollupValue ? (fieldId) => getRollupValue(rowId, fieldId) : undefined,
  };
}

/**
 * `formulaConditionContext` for one row whose rollups are read straight from
 * the rollup cache (footers and type conversion).
 */
export function formulaRowContext(
  rowId: string,
  row: YDatabaseRow,
  options: { members?: MemberNames; database?: YDatabase; baseDoc: YDoc; loaders: RelatedRowLoaders }
): ReadFieldValueContext {
  const { members, database, baseDoc, loaders } = options;

  return formulaConditionContext(rowId, {
    members,
    loaders,
    getRollupValue: database
      ? (_rowId, fieldId) => {
          const rollupField = database.get(YjsDatabaseKey.fields)?.get(fieldId);

          return rollupField
            ? readRollupCellSync({ baseDoc, database, rollupField, row, rowId, fieldId, ...loaders })
            : undefined;
        }
      : undefined,
  });
}

type RelatedRow = { relationField: YDatabaseField; relatedRowId: string };

const noopUnsubscribe = () => undefined;

/**
 * The read context of one formula evaluation (a cell or the editor preview).
 * It loads only what `references` reach and returns a `revision` that changes
 * when a member list, one of this row's related titles or a rollup result
 * arrives. Pass `NO_EXTERNAL_REFERENCES` when there is nothing to load.
 */
export function useFormulaReadContext({
  references: nextReferences,
  row,
  rowId,
  rowClock,
}: {
  references: FormulaExternalReferences;
  row?: YDatabaseRow;
  rowId: string;
  /** Bumps when the row's cells change. */
  rowClock: number;
}): { context: ReadFieldValueContext; revision: string } {
  const database = useDatabase();
  const { databaseDoc, loadView, createRow, getViewIdFromDatabaseId } = useDatabaseContext();
  // Recomputed references to the same fields keep one identity, so a draft
  // being typed does not re-subscribe on every keystroke.
  const referencesKey = formulaExternalReferencesKey(nextReferences);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const references = useMemo(() => nextReferences, [referencesKey]);
  const clock = useFormulaClock(references.clock);
  const loadersRef = useRef<RelatedRowLoaders>({ loadView, createRow, getViewIdFromDatabaseId });

  useEffect(() => {
    loadersRef.current = { loadView, createRow, getViewIdFromDatabaseId };
  }, [loadView, createRow, getViewIdFromDatabaseId]);

  // Member names (Person, Created by, Last edited by).
  const { users } = useMentionableUsersWithAutoFetch(references.people);
  const members = useMemo(() => memberNames(users), [users]);

  // Related row titles: re-render only when one of this row's titles changes.
  const relatedRowIdsKey = useMemo(() => {
    void rowClock;
    const cells = row?.get(YjsDatabaseKey.cells);

    return JSON.stringify(references.relations.map((entry) => getRelationRowIdsFromCell(cells?.get(entry.id))));
  }, [references.relations, row, rowClock]);
  const relatedRows = useMemo<RelatedRow[]>(() => {
    const idsByField: string[][] = JSON.parse(relatedRowIdsKey);

    return references.relations.flatMap((entry, index) =>
      idsByField[index].map((relatedRowId) => ({
        relationField: entry.field,
        relatedRowId,
      }))
    );
  }, [references.relations, relatedRowIdsKey]);
  const titleStore = useMemo(() => {
    const values = relatedRows.map((key) => readRelationGroupLabel(key));
    let revision = 0;

    return {
      // Snapshot reads stay constant-time as individual titles arrive.
      getSnapshot: () => revision,
      subscribe: (notify: () => void) => {
        if (relatedRows.length === 0) return noopUnsubscribe;
        const release = retainRelationGroupLabels(relatedRows);
        const unsubscribes = relatedRows.map((key, index) => {
          const refresh = () => {
            // Only a changed title needs another lookup after invalidation.
            ensureRelationGroupLabel({ ...key, ...loadersRef.current });
            const value = readRelationGroupLabel(key);

            if (value === values[index]) return;
            values[index] = value;
            revision += 1;
            notify();
          };

          const unsubscribe = subscribeRelationGroupLabel(key, refresh);

          // Close the render-to-subscribe gap and start cold lookups.
          refresh();
          return unsubscribe;
        });

        return () => {
          unsubscribes.forEach((unsubscribe) => unsubscribe());
          release();
        };
      },
    };
  }, [relatedRows]);
  const titles = useSyncExternalStore(titleStore.subscribe, titleStore.getSnapshot, titleStore.getSnapshot);

  // Rollup results.
  const [rollupValues, setRollupValues] = useState<Record<string, RollupCellValue>>({});
  const rollupFieldIds = useMemo(() => references.rollups.map((entry) => entry.id), [references.rollups]);
  const observedRows = useMemo(() => (row?.doc ? { [rowId]: row.doc as YDoc } : {}), [row, rowId]);
  const refreshRollups = useCallback(() => {
    if (!database || !row) return;
    references.rollups.forEach((entry) => {
      void readRollupCell({
        baseDoc: databaseDoc,
        database,
        rollupField: entry.field,
        row,
        rowId,
        fieldId: entry.id,
        ...loadersRef.current,
      }).catch((error: unknown) => console.error('[Formula] Failed to refresh rollup', error));
    });
  }, [database, databaseDoc, row, rowId, references.rollups]);

  // The observer tracks relation membership; unrelated row edits need no reload.
  useRollupFieldObservers(refreshRollups, 0, {
    rows: observedRows,
    rollupFieldIds,
    observeConditions: false,
  });

  useEffect(() => {
    if (!database || !row || references.rollups.length === 0) return;
    let cancelled = false;

    setRollupValues({});
    const unsubscribes = references.rollups.map((entry) => {
      const cellId = `${rowId}:${entry.id}`;
      const apply = (value: RollupCellValue) => {
        if (cancelled) return;
        setRollupValues((previous) => (previous[entry.id] === value ? previous : { ...previous, [entry.id]: value }));
      };

      // Both row contents and field options can change what this cell reads.
      invalidateRollupCell(cellId);
      return subscribeRollupCell(cellId, apply);
    });

    refreshRollups();

    return () => {
      cancelled = true;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [references.rollups, database, row, rowId, databaseDoc, refreshRollups]);

  const hasRelations = references.relations.length > 0;
  const hasRollups = references.rollups.length > 0;
  const context = useMemo<ReadFieldValueContext>(
    () => ({
      getUserName: members.getUserName,
      getPersonName: members.getPersonName,
      getRelatedRowTitle: hasRelations
        ? (relationField, relatedRowId) => readRelationGroupLabel({ relationField, relatedRowId }) || undefined
        : undefined,
      getRollupValue: hasRollups ? (fieldId) => rollupValues[fieldId] : undefined,
    }),
    [members, hasRelations, hasRollups, rollupValues]
  );

  return { context, revision: `${clock}:${titles}` };
}
