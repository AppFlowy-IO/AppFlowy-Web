import { waitForDatabaseHydration } from '@/application/database-yjs/database.hydration';
import { decodeCellToText } from '@/application/database-yjs/decode';
import { FormulaExternalReferences, ReadFieldValueContext } from '@/application/database-yjs/fields/formula';
import { parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { memberNames, RelatedRowLoaders } from '@/application/database-yjs/formula/read-context';
import { readRelationMembership } from '@/application/database-yjs/relation/cache';
import { getRelationRowIdsFromCell } from '@/application/database-yjs/relation/cell';
import { resolveRollupCell } from '@/application/database-yjs/rollup/cache';
import { waitForDatabaseRowHydration } from '@/application/database-yjs/row.hydration';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { YDatabase, YDatabaseField, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { loadMentionableUsers } from '@/components/database/components/cell/person/useMentionableUsers';

/** A permanent conversion must not mistake unhydrated row orders for live membership. */
export function waitForRelationMembership(doc: YDoc): Promise<ReadonlySet<string>> {
  const existing = readRelationMembership(doc);

  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      doc.off('update', changed);
      clearTimeout(timer);
    };

    const changed = () => {
      const ids = readRelationMembership(doc);

      if (!ids) return;
      cleanup();
      resolve(ids);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Related database row membership could not be loaded for formula conversion'));
    }, 3000);

    doc.on('update', changed);
  });
}

/** Watch related rows and schemas before their values are read, for one conversion pass. */
export function observeFormulaRelatedDocuments(loaders: RelatedRowLoaders, changed: () => void) {
  const { loadView, createRow } = loaders;
  const documents = new Set<YDoc>();
  let active = true;
  const observe = <T extends YDoc | null>(doc: T): T => {
    if (active && doc && !documents.has(doc)) {
      documents.add(doc);
      doc.on('update', changed);
    }

    return doc;
  };

  return {
    loaders: {
      ...loaders,
      loadView: loadView ? async (...args) => observe(await loadView(...args)) : undefined,
      createRow: createRow ? async (...args) => observe(await createRow(...args)) : undefined,
    } satisfies RelatedRowLoaders,
    dispose: () => {
      // A sibling read may still settle after another read fails. It must not
      // attach observers after this pass has already been released.
      active = false;
      documents.forEach((doc) => doc.off('update', changed));
      documents.clear();
    },
  };
}

/** Resolve external values before a formula's result becomes a stored cell. */
export async function resolveFormulaRowContext({
  references,
  row,
  rowId,
  database,
  baseDoc,
  loaders,
  workspaceId,
}: {
  references: FormulaExternalReferences;
  row: YDatabaseRow;
  rowId: string;
  database: YDatabase;
  baseDoc: YDoc;
  loaders: RelatedRowLoaders;
  workspaceId?: string;
}): Promise<ReadFieldValueContext> {
  const titles = new Map<YDatabaseField, Map<string, string | null>>();
  const [members, rollups] = await Promise.all([
    references.people ? loadMentionableUsers(workspaceId).then(memberNames) : undefined,
    Promise.all(
      references.rollups.map(
        async (entry) =>
          [
            entry.id,
            await resolveRollupCell({
              baseDoc,
              database,
              rollupField: entry.field,
              fieldId: entry.id,
              row,
              rowId,
              ...loaders,
              workspaceId,
            }),
          ] as const
      )
    ),
    Promise.all(
      references.relations.map(async (entry) => {
        const rowIds = getRelationRowIdsFromCell(row.get(YjsDatabaseKey.cells)?.get(entry.id));

        if (rowIds.length === 0) return;
        const databaseId = parseRelationTypeOption(entry.field).database_id;

        if (!databaseId) return;
        const viewId = await loaders.getViewIdFromDatabaseId?.(databaseId);
        const doc = viewId
          ? await loaders.loadView?.(viewId, false, false, { databaseId, databaseMetadataOnly: true })
          : null;
        const relatedDatabase = doc ? await waitForDatabaseHydration(doc) : null;

        if (!doc || !relatedDatabase)
          throw new Error(`Related database ${databaseId} could not be loaded for formula conversion`);
        const liveRowIds = await waitForRelationMembership(doc);
        const fields = relatedDatabase.get(YjsDatabaseKey.fields);
        const primary = Array.from(fields?.values() ?? []).find((field) => field.get(YjsDatabaseKey.is_primary));
        const names = new Map<string, string | null>();

        titles.set(entry.field, names);
        for (const relatedRowId of rowIds) {
          if (!liveRowIds.has(relatedRowId)) {
            names.set(relatedRowId, null);
            continue;
          }

          const relatedDoc = await loaders.createRow?.(getRowKey(doc.guid, relatedRowId));

          if (!relatedDoc || !(await waitForDatabaseRowHydration(relatedDoc))) {
            throw new Error(`Related row ${relatedRowId} could not be loaded for formula conversion`);
          }

          const relatedRow = relatedDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
          const cell = primary ? relatedRow.get(YjsDatabaseKey.cells)?.get(primary.get(YjsDatabaseKey.id)) : undefined;

          names.set(relatedRowId, cell && primary ? decodeCellToText(cell, primary).trim() : '');
        }
      })
    ),
  ]);
  const rollupValues = new Map(rollups);

  return {
    ...members,
    getRelatedRowTitle: (field, relatedRowId) => titles.get(field)?.get(relatedRowId),
    getRollupValue: (fieldId) => rollupValues.get(fieldId),
  };
}
