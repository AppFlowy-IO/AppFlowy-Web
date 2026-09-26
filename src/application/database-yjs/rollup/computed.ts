import { waitForDatabaseHydration } from '@/application/database-yjs/database.hydration';
import { readRelationMembership } from '@/application/database-yjs/relation/cache';
import { decodeCellToText } from '@/application/database-yjs/decode';
import { evaluateFormulaCell } from '@/application/database-yjs/fields/formula/evaluate';
import { collectFormulaExternalReferences } from '@/application/database-yjs/fields/formula/references';
import { readFormulaSchema } from '@/application/database-yjs/fields/formula/schema';
import { parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { getRelationRowIdsFromCell } from '@/application/database-yjs/relation/cell';
import { getRowKey } from '@/application/database-yjs/row_meta';
import {
  YDatabase,
  YDatabaseField,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey as K,
  YjsEditorKey as E,
} from '@/application/types';
import { canonicalizeUserUid } from '@/application/user-uid';

import type { RollupCellValue, RollupComputeContext } from './cache';

export class ComputedDependencyError extends Error {}

/** One evaluation path crosses database boundaries without sharing an in-flight cache promise. */
export interface ComputedSession {
  signal?: AbortSignal;
  path: ReadonlySet<string>;
  rollupDepth?: number;
  now: number;
  observe?: (doc: YDoc) => void;
  usesClock?: () => void;
  usesPeople?: () => void;
}

export function enterComputedCell(
  context: RollupComputeContext,
  session: ComputedSession,
  formula = false
): ComputedSession {
  if (session.signal?.aborted) throw new DOMException('Rollup observation cancelled', 'AbortError');
  const key = JSON.stringify([context.database.get(K.id) ?? context.baseDoc.guid, context.rowId, context.fieldId]);

  if (session.path.has(key)) throw new ComputedDependencyError('Circular formula and rollup dependency');
  // Match Desktop: the limit counts rollup hops, independently of intervening Formula nodes.
  const rollupDepth = session.rollupDepth ?? 0;

  if (!formula && rollupDepth >= 64) throw new ComputedDependencyError('Formula and rollup dependencies are too deep');
  const path = new Set(session.path);

  path.add(key);
  session.observe?.(context.baseDoc);
  if (context.row.doc) session.observe?.(context.row.doc as YDoc);
  return { ...session, path, rollupDepth: rollupDepth + (formula ? 0 : 1) };
}

/** Resolve external inputs first, then evaluate the formula with their raw typed values. */
export async function evaluateRollupFormula(
  context: RollupComputeContext,
  session: ComputedSession,
  computeRollup: (context: RollupComputeContext, session: ComputedSession) => Promise<RollupCellValue>
) {
  const current = enterComputedCell(context, session, true);
  const schema = readFormulaSchema(context.database.get(K.fields));
  const references = collectFormulaExternalReferences(context.rollupField, schema);
  const titles = new Map<YDatabaseField, Map<string, string | null>>();

  if (references.clock) current.usesClock?.();
  if (references.people) current.usesPeople?.();
  const [rollups, members] = await Promise.all([
    Promise.all(
      references.rollups.map(
        async (entry) =>
          [
            entry.id,
            await computeRollup(
              {
                ...context,
                rollupField: entry.field,
                fieldId: entry.id,
              },
              current
            ),
          ] as const
      )
    ),
    references.people && (context.workspaceId || context.requireLoadedSources)
      ? import('@/components/database/components/cell/person/useMentionableUsers').then(({ loadMentionableUsers }) =>
          loadMentionableUsers(context.workspaceId)
        )
      : undefined,
    Promise.all(
      references.relations.map(async (entry) => {
        const ids = getRelationRowIdsFromCell(context.row.get(K.cells)?.get(entry.id));
        const names = new Map<string, string | null>();

        titles.set(entry.field, names);
        if (ids.length === 0) return;
        const databaseId = parseRelationTypeOption(entry.field)?.database_id;
        const viewId = databaseId ? await context.getViewIdFromDatabaseId?.(databaseId) : null;
        const doc =
          viewId && databaseId
            ? await context.loadView?.(viewId, false, false, { databaseId, databaseMetadataOnly: true })
            : null;

        if (!doc) {
          if (context.requireLoadedSources)
            throw new Error(`Related database ${databaseId ?? ''} could not be loaded for formula conversion`);
          return;
        }

        current.observe?.(doc);
        const database = context.requireLoadedSources
          ? await waitForDatabaseHydration(doc)
          : (doc.getMap(E.data_section).get(E.database) as YDatabase | undefined);

        if (!database && context.requireLoadedSources)
          throw new Error(`Related database ${databaseId} could not be loaded for formula conversion`);
        const membership = context.requireLoadedSources
          ? await import('@/application/database-yjs/formula/materialize').then(({ waitForRelationMembership }) =>
              waitForRelationMembership(doc)
            )
          : readRelationMembership(doc);
        const primary = Array.from(database?.get(K.fields)?.values() ?? []).find((field) => field.get(K.is_primary));

        if (!primary) {
          if (context.requireLoadedSources)
            throw new Error(`Related database ${databaseId} title property could not be loaded for formula conversion`);
          return;
        }

        for (const id of ids) {
          if (current.signal?.aborted) throw new DOMException('Rollup observation cancelled', 'AbortError');
          if (membership && !membership.has(id)) {
            names.set(id, null);
            continue;
          }

          const rowDoc = await context.createRow?.(getRowKey(doc.guid, id));

          if (!rowDoc) {
            if (context.requireLoadedSources)
              throw new Error(`Related row ${id} could not be loaded for formula conversion`);
            continue;
          }

          current.observe?.(rowDoc);
          const row = rowDoc.getMap(E.data_section).get(E.database_row) as YDatabaseRow | undefined;

          if (!row && context.requireLoadedSources)
            throw new Error(`Related row ${id} could not be loaded for formula conversion`);
          const cell = row?.get(K.cells)?.get(primary.get(K.id));

          names.set(id, cell ? decodeCellToText(cell, primary) : '');
        }
      })
    ),
  ]);
  const values = new Map(rollups);
  const memberByUid = new Map(
    members?.map((member) => [canonicalizeUserUid(member.uid), member.name?.trim() || member.email?.trim()])
  );
  const memberByPersonId = new Map(
    members?.map((member) => [member.person_id, member.name?.trim() || member.email?.trim()])
  );

  return evaluateFormulaCell({
    schema,
    field: context.rollupField,
    fieldId: context.fieldId,
    row: context.row,
    rowId: context.rowId,
    now: () => current.now,
    getRollupValue: (id) => values.get(id),
    getRelatedRowTitle: (field, id) => titles.get(field)?.get(id),
    getUserName: (uid) => memberByUid.get(canonicalizeUserUid(uid)),
    getPersonName: (id) => memberByPersonId.get(id),
  });
}
