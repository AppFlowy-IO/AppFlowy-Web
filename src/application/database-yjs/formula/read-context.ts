/**
 * Formula values that live outside the row document: member names, related
 * row titles and rollup results. Cells, filters, sorts and footers all read
 * them through a `ReadFieldValueContext` built here.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { useDatabase, useDatabaseContext } from '@/application/database-yjs/context';
import {
  collectFormulaExternalReferences,
  FormulaFieldSchema,
  NO_EXTERNAL_REFERENCES,
  ReadFieldValueContext,
} from '@/application/database-yjs/fields/formula';
import {
  ensureRelationGroupLabel,
  getRelationGroupLabelRevision,
  readRelationGroupLabel,
  retainRelationGroupLabels,
  subscribeRelationGroupLabels,
} from '@/application/database-yjs/relation/cache';
import { getRelationRowIdsFromCell } from '@/application/database-yjs/relation/cell';
import {
  invalidateRollupCell,
  readRollupCell,
  RollupCellValue,
  subscribeRollupCell,
} from '@/application/database-yjs/rollup/cache';
import {
  LoadViewOptions,
  MentionablePerson,
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

const noopSubscribe = () => () => undefined;
const zeroRevision = () => 0;

/**
 * The read context of one formula cell. It loads only what the formula
 * reaches (directly or through other formulas) and re-renders the cell when
 * a member list, related title or rollup result arrives.
 */
export function useFormulaCellReadContext({
  enabled,
  field,
  schema,
  row,
  rowId,
  rowClock,
}: {
  enabled: boolean;
  field?: YDatabaseField;
  schema: FormulaFieldSchema[];
  row?: YDatabaseRow;
  rowId: string;
  /** Bumps when the row's cells change. */
  rowClock: number;
}): { context: ReadFieldValueContext; revision: number } {
  const database = useDatabase();
  const { databaseDoc, loadView, createRow, getViewIdFromDatabaseId } = useDatabaseContext();
  const references = useMemo(
    () => (enabled && field ? collectFormulaExternalReferences(field, schema) : NO_EXTERNAL_REFERENCES),
    [enabled, field, schema]
  );

  // Member names (Person, Created by, Last edited by).
  const { users } = useMentionableUsersWithAutoFetch(references.people);
  const members = useMemo(() => memberNames(users), [users]);

  // Related row titles.
  const hasRelations = references.relations.length > 0;
  const labelRevision = useSyncExternalStore(
    hasRelations ? subscribeRelationGroupLabels : noopSubscribe,
    hasRelations ? getRelationGroupLabelRevision : zeroRevision,
    hasRelations ? getRelationGroupLabelRevision : zeroRevision
  );
  const relatedRows = useMemo(() => {
    void rowClock;
    const cells = row?.get(YjsDatabaseKey.cells);

    return references.relations.flatMap((entry) =>
      getRelationRowIdsFromCell(cells?.get(entry.id)).map((relatedRowId) => ({
        relationField: entry.field,
        relatedRowId,
      }))
    );
  }, [references.relations, row, rowClock]);

  useEffect(() => {
    if (relatedRows.length === 0) return;
    // Keep this row's titles out of the label cache's eviction.
    return retainRelationGroupLabels(relatedRows);
  }, [relatedRows]);

  useEffect(() => {
    // A title past its TTL is looked up again once the revision moves.
    void labelRevision;
    relatedRows.forEach((key) => ensureRelationGroupLabel({ ...key, loadView, createRow, getViewIdFromDatabaseId }));
  }, [relatedRows, labelRevision, loadView, createRow, getViewIdFromDatabaseId]);

  // Rollup results.
  const [rollupValues, setRollupValues] = useState<Record<string, RollupCellValue>>({});

  useEffect(() => {
    if (!database || !row || references.rollups.length === 0) return;
    let cancelled = false;
    const unsubscribes = references.rollups.map((entry) => {
      const cellId = `${rowId}:${entry.id}`;
      const apply = (value: RollupCellValue) => {
        if (cancelled) return;
        setRollupValues((previous) => (previous[entry.id] === value ? previous : { ...previous, [entry.id]: value }));
      };

      // The row changed: its relation may point at other rows now.
      if (rowClock > 0) invalidateRollupCell(cellId);
      void readRollupCell({
        baseDoc: databaseDoc,
        database,
        rollupField: entry.field,
        row,
        rowId,
        fieldId: entry.id,
        loadView,
        createRow,
        getViewIdFromDatabaseId,
      }).then(apply);
      return subscribeRollupCell(cellId, apply);
    });

    return () => {
      cancelled = true;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [references.rollups, database, row, rowId, rowClock, databaseDoc, loadView, createRow, getViewIdFromDatabaseId]);

  const context = useMemo<ReadFieldValueContext>(
    () => ({
      getUserName: members.getUserName,
      getPersonName: members.getPersonName,
      getRelatedRowTitle: hasRelations
        ? (relationField, relatedRowId) => readRelationGroupLabel({ relationField, relatedRowId }) || undefined
        : undefined,
      getRollupValue: references.rollups.length > 0 ? (fieldId) => rollupValues[fieldId] : undefined,
    }),
    [members, hasRelations, references.rollups.length, rollupValues]
  );

  return { context, revision: labelRevision };
}
