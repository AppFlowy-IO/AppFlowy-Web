/**
 * Row dispatch hooks
 *
 * Handles all row-related mutations:
 * - useReorderRowDispatch: Reorder rows within a view
 * - useMoveCardDispatch: Move card between board columns
 * - useDeleteRowDispatch: Delete a single row
 * - useBulkDeleteRowDispatch: Delete multiple rows
 * - useNewRowDispatch: Create a new row
 * - useDuplicateRowDispatch: Duplicate an existing row
 * - useUpdateRowMetaDispatch: Update row metadata (icon, cover, etc.)
 */

import dayjs from 'dayjs';
import { fromBase64 } from 'lib0/buffer';
import { useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

import { resolveUserAttributionUid, touchRowAttribution } from '@/application/database-yjs/attribution';
import { cloneDatabaseCell } from '@/application/database-yjs/cell.clone';
import { setCellStoredType } from '@/application/database-yjs/cell.field-type';
import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import {
  useCreateRow,
  useDatabase,
  useDatabaseContext,
  useDatabaseView,
  useDatabaseViewId,
  useDocGuid,
  useRowMap,
  useSharedRoot,
} from '@/application/database-yjs/context';
import { CommittedRowActivationError, createCloudRow } from '@/application/database-yjs/creation/create-row';
import { FieldType, isAttributionFieldType, RowMetaKey } from '@/application/database-yjs/database.type';
import { createCheckboxCell } from '@/application/database-yjs/fields/checkbox/utils';
import { createSelectOptionCell } from '@/application/database-yjs/fields/select-option/utils';
import { CellWriteIntent, checkExistingCellWrite } from '@/application/database-yjs/fields/text/rich-text-guard';
import { notifyRichTextNewer } from '@/application/database-yjs/fields/text/rich-text-notice';
import { getNumberGroupingCellData } from '@/application/database-yjs/group';
import {
  createDatabaseHistoryGroup,
  executeDatabaseOperations as executeOperations,
  getOrCreateDatabaseHistoryManager,
  registerDatabaseHistoryRowDoc,
  runDatabaseRowAction,
} from '@/application/database-yjs/history';
import { isDatabaseHistoryDocumentImmutable } from '@/application/database-yjs/immutable';
import { createNumberGroupingPolicy } from '@/application/database-yjs/number-grouping';
import { initialDatabaseRow } from '@/application/database-yjs/row';
import { generateRowMeta, getMetaIdMap, getMetaJSON, getRowKey } from '@/application/database-yjs/row_meta';
import { getPrimaryFieldId, useCalendarLayoutSetting, useDatabaseViewLayout } from '@/application/database-yjs/selector';
import {
  DatabaseRowTemplateStore,
  mergeTemplateViewDecorations,
  readDatabaseRowTemplateState,
  templateDecorationsNeedResolution,
} from '@/application/database-yjs/template';
import {
  decodeTemplateDocumentSnapshot,
  readTemplateDocumentEmptiness,
} from '@/application/database-yjs/template/document';
import { duplicateTimelineRowDependencyLinks } from '@/application/database-yjs/timeline-layout';
import { deleteCollabDB, getCachedProviderDoc } from '@/application/db';
import {
  ensureRowDocumentView,
  rowDocumentExists,
  rowDocumentIdFromRowId,
  syncRowDocumentViewName,
} from '@/application/row-document/lifecycle';
import { PageService } from '@/application/services/domains';
import { getCachedRowSubDoc } from '@/application/services/js-services/cache';
import { deleteOutboxByObjectId } from '@/application/sync-outbox';
import {
  DatabaseViewLayout,
  FieldId,
  YDatabaseCell,
  YDatabaseCells,
  YDatabaseRow,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Log } from '@/utils/log';

import { populateNewRowCells, NewRowCellsData } from './new-row-cells';
import { applyRelationReciprocalInserts } from './relation';
import { removeRowsFromDatabase, softDeleteRowsInDatabase } from './row-lifecycle';
import { executeOperationWithAllViews } from './utils';

export { collectNewRowPrefillFilters } from './new-row-cells';

/**
 * Helper: Reorder a row within a view's row_orders
 */
function reorderRow(rowId: string, beforeRowId: string | undefined, view: YDatabaseView) {
  const rows = view.get(YjsDatabaseKey.row_orders);

  if (!rows) {
    throw new Error('Row orders not found');
  }

  const rowArray = rows.toJSON() as {
    id: string;
  }[];

  const sourceIndex = rowArray.findIndex((row) => row.id === rowId);
  const targetIndex = beforeRowId !== undefined ? rowArray.findIndex((row) => row.id === beforeRowId) + 1 : 0;

  const row = rows.get(sourceIndex);

  rows.delete(sourceIndex);

  let adjustedTargetIndex = targetIndex;

  if (targetIndex > sourceIndex) {
    adjustedTargetIndex -= 1;
  }

  rows.insert(adjustedTargetIndex, [row]);
}

export function useReorderRowDispatch() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (rowId: string, beforeRowId?: string) => {
      executeOperations(
        sharedRoot,
        [
          () => {
            if (!view) {
              throw new Error(`Unable to reorder card`);
            }

            reorderRow(rowId, beforeRowId, view);
          },
        ],
        'reorderRow'
      );
    },
    [view, sharedRoot]
  );
}

/** What moving a card writes into the grouping field's cell. */
function moveCardWriteIntent(data: unknown): CellWriteIntent {
  return { set: { [YjsDatabaseKey.data]: data }, delete: [YjsDatabaseKey.source_field_type] };
}

export function useMoveCardDispatch() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();
  const rowMap = useRowMap();
  const database = useDatabase();
  const { databaseDoc } = useDatabaseContext();
  const currentUser = useCurrentUserOptional();
  const actorUid = resolveUserAttributionUid(currentUser);

  return useCallback(
    ({
      rowId,
      beforeRowId,
      fieldId,
      startColumnId,
      finishColumnId,
    }: {
      rowId: string;
      beforeRowId?: string;
      fieldId: string;
      startColumnId: string;
      finishColumnId: string;
    }) => {
      if (!view) {
        throw new Error(`Unable to reorder card`);
      }

      const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

      if (!field) {
        throw new Error(`Field not found`);
      }

      const fieldType = Number(field.get(YjsDatabaseKey.type));
      const rowDoc = rowMap?.[rowId];
      const historyGroup = createDatabaseHistoryGroup();

      if (!isAttributionFieldType(fieldType)) {
        if (!rowDoc) {
          throw new Error(`Unable to reorder card`);
        }

        getOrCreateDatabaseHistoryManager(databaseDoc).registerRowDoc(rowId, rowDoc);
      }

      executeOperations(
        sharedRoot,
        [
          () => {
            if (isAttributionFieldType(fieldType)) {
              // Attribution columns are groupable for display, but moving a
              // card must never rewrite their read-only row metadata.
              if (startColumnId === finishColumnId) {
                reorderRow(rowId, beforeRowId, view);
              }

              return;
            }

            let refused = false;

            runDatabaseRowAction(
              rowDoc as YDoc,
              { type: 'row.move-card-cell', rowId, fieldId, fieldType, historyGroup },
              () => {
                const row = (rowDoc as YDoc)
                  .getMap(YjsEditorKey.data_section)
                  .get(YjsEditorKey.database_row) as YDatabaseRow;
                const cells = row.get(YjsDatabaseKey.cells);
                const isSelectOptionField = [FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType);
                let cellChanged = false;
                let cell = cells.get(fieldId);

                if (fieldType === FieldType.Number) {
                  const group = view
                    .get(YjsDatabaseKey.groups)
                    ?.toArray()
                    .find((candidate) => candidate.get(YjsDatabaseKey.field_id) === fieldId);
                  const policy = createNumberGroupingPolicy(group?.get(YjsDatabaseKey.content));
                  const currentGroupId = policy.groupIdForCell(getNumberGroupingCellData(cell)) ?? fieldId;

                  // Reordering within a numeric bucket must preserve its actual
                  // value, including values away from the bucket's lower bound.
                  if (startColumnId === finishColumnId || currentGroupId === finishColumnId) return;
                  const value = finishColumnId === fieldId ? '' : policy.valueForGroup(finishColumnId);

                  if (value === undefined) throw new RangeError('Invalid number group');

                  // A cell needing a newer client keeps its value; the card
                  // snaps back (rich text spec R49).
                  const check = checkExistingCellWrite(cell, moveCardWriteIntent(value));

                  if (check !== 'proceed') {
                    refused = check === 'refuse';
                    return;
                  }

                  if (!cell) {
                    cell = new Y.Map() as YDatabaseCell;
                    cells.set(fieldId, cell);
                  }

                  cell.set(YjsDatabaseKey.data, value);
                  setCellStoredType(cell, fieldType);
                  cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
                  touchRowAttribution(row, actorUid);
                  return;
                }

                if (!cell) {
                  // if the cell is empty, create a new cell and set data to finishColumnId
                  if (isSelectOptionField) {
                    cell = createSelectOptionCell(fieldId, fieldType, finishColumnId);
                  } else if (fieldType === FieldType.Checkbox) {
                    cell = createCheckboxCell(fieldId, finishColumnId);
                  }

                  if (cell) {
                    cells.set(fieldId, cell);
                    cellChanged = true;
                  }
                } else {
                  const cellData = parseYDatabaseCellToCell(cell, field).data;
                  let newCellData = cellData;

                  if (isSelectOptionField) {
                    const selectedIds = (cellData as string)?.split(',') ?? [];
                    const index = selectedIds.findIndex((id) => id === startColumnId);

                    if (selectedIds.includes(finishColumnId)) {
                      // if the finishColumnId is already in the selectedIds
                      selectedIds.splice(index, 1); // remove the startColumnId from the selectedIds
                    } else {
                      selectedIds.splice(index, 1, finishColumnId); // replace the startColumnId with finishColumnId
                    }

                    newCellData = selectedIds.join(',');
                  } else if (fieldType === FieldType.Checkbox) {
                    newCellData = finishColumnId;
                  }

                  const check = checkExistingCellWrite(cell, moveCardWriteIntent(newCellData));

                  if (check !== 'proceed') {
                    refused = check === 'refuse';
                    return;
                  }

                  cell.set(YjsDatabaseKey.data, newCellData);
                  setCellStoredType(cell, fieldType);
                  cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
                  cellChanged = newCellData !== cellData;
                }

                if (cellChanged) {
                  touchRowAttribution(row, actorUid);
                }
              }
            );

            // The move is refused as a whole: the card stays where it was.
            if (refused) {
              notifyRichTextNewer();
              return;
            }

            reorderRow(rowId, beforeRowId, view);
          },
        ],
        'reorderCard',
        { type: 'database.reorder-card', rowId, fieldId, fieldType, historyGroup }
      );
    },
    [actorUid, database, databaseDoc, rowMap, sharedRoot, view]
  );
}

export function useDeleteRowDispatch() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (rowId: string) => {
      if (sharedRoot.doc && isDatabaseHistoryDocumentImmutable(sharedRoot.doc as YDoc)) return;

      executeOperationWithAllViews(
        sharedRoot,
        database,
        (view) => {
          if (!view) {
            throw new Error(`Unable to delete row`);
          }

          const rows = view.get(YjsDatabaseKey.row_orders);

          const rowArray = rows.toJSON() as {
            id: string;
          }[];

          const sourceIndex = rowArray.findIndex((row) => row.id === rowId);

          rows.delete(sourceIndex);
        },
        'deleteRowDispatch'
      );
      void deleteOutboxByObjectId(rowId);
      void deleteCollabDB(rowId, { destroyDoc: false });
    },
    [sharedRoot, database]
  );
}

export function useBulkDeleteRowDispatch() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (rowIds: string[], historyGroup?: object) => {
      if (sharedRoot.doc && isDatabaseHistoryDocumentImmutable(sharedRoot.doc as YDoc)) return;

      executeOperationWithAllViews(
        sharedRoot,
        database,
        (view) => {
          if (!view) {
            throw new Error(`Unable to bulk delete rows`);
          }

          const rows = view.get(YjsDatabaseKey.row_orders);

          rowIds.forEach((rowId) => {
            const rowArray = rows.toJSON() as {
              id: string;
            }[];

            const sourceIndex = rowArray.findIndex((row) => row.id === rowId);

            // If the row is not found, skip it
            if (sourceIndex !== -1) {
              rows.delete(sourceIndex);
            }
          });
        },
        'bulkDeleteRowDispatch',
        historyGroup
      );
      rowIds.forEach((rowId) => {
        void deleteOutboxByObjectId(rowId);
        void deleteCollabDB(rowId, { destroyDoc: false });
      });
    },
    [sharedRoot, database]
  );
}

export function useSoftDeleteRowsDispatch() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (rowIds: string[]) => {
      softDeleteRowsInDatabase(sharedRoot, database, rowIds);
    },
    [sharedRoot, database]
  );
}

function readPrimaryCellText(rowDoc: Y.Doc, database: ReturnType<typeof useDatabase>): string {
  const primaryFieldId = getPrimaryFieldId(database);

  if (!primaryFieldId) return '';

  const row = rowDoc.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;
  const data = row?.get(YjsDatabaseKey.cells)?.get(primaryFieldId)?.get(YjsDatabaseKey.data);

  return typeof data === 'string' ? data : '';
}

/**
 * Trash-aware row deletion mirroring desktop semantics:
 * - rows whose document has content are tombstoned (restorable) and their
 *   row-document view is moved to trash;
 * - rows without document content are hard-deleted with no trash entry.
 *
 * The tombstone is applied synchronously so the UI updates immediately; the
 * trash HTTP calls run afterwards and never resurrect the row on failure.
 */
export function useTrashAwareDeleteRowsDispatch() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const context = useDatabaseContext();
  const { rowMap, ensureRow, workspaceId, activeViewId, databasePageId, databaseDoc } = context;

  return useCallback(
    async (rowIds: string[]) => {
      const databaseId = (database?.get(YjsDatabaseKey.id) as string | undefined) || databaseDoc.guid;
      const databaseViewId = activeViewId || databasePageId;
      const softTargets: { rowId: string; documentId: string; title: string }[] = [];
      const hardCandidates: { rowId: string; documentId: string; rowDoc?: Y.Doc }[] = [];

      for (const rowId of rowIds) {
        let rowDoc = rowMap?.[rowId];

        if (!rowDoc && ensureRow) {
          try {
            rowDoc = (await ensureRow(rowId)) ?? undefined;
          } catch (e) {
            Log.warn('[useTrashAwareDeleteRowsDispatch] ensureRow failed', { rowId, error: e });
          }
        }

        const metaMap = rowDoc?.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.meta) as Y.Map<unknown> | undefined;
        const meta = metaMap ? getMetaJSON(rowId, metaMap) : null;
        const documentId = meta?.documentId || rowDocumentIdFromRowId(rowId);

        // Desktop: row_has_document = !is_document_empty.
        if (meta?.isEmptyDocument === false && rowDoc) {
          softTargets.push({
            rowId,
            documentId,
            title: readPrimaryCellText(rowDoc, database),
          });
        } else {
          hardCandidates.push({ rowId, documentId, rowDoc });
        }
      }

      // Desktop's existing_row_document_metadata_candidates: a row whose meta
      // says empty is still trashed when its row document was materialized on
      // the server (e.g. content typed then cleared, or stale meta).
      if (hardCandidates.length > 0 && workspaceId) {
        const promoted = await Promise.all(
          hardCandidates.map(async (candidate) => ({
            candidate,
            exists: await rowDocumentExists(workspaceId, candidate.documentId),
          }))
        );

        promoted.forEach(({ candidate, exists }) => {
          if (exists) {
            softTargets.push({
              rowId: candidate.rowId,
              documentId: candidate.documentId,
              title: candidate.rowDoc ? readPrimaryCellText(candidate.rowDoc, database) : '',
            });
          }
        });
      }

      const softRowIds = new Set(softTargets.map((target) => target.rowId));
      const hardTargets = hardCandidates.map(({ rowId }) => rowId).filter((rowId) => !softRowIds.has(rowId));

      if (softTargets.length > 0) {
        softDeleteRowsInDatabase(
          sharedRoot,
          database,
          softTargets.map((target) => target.rowId)
        );

        if (workspaceId && databaseId && databaseViewId) {
          void (async () => {
            for (const { rowId, documentId, title } of softTargets) {
              try {
                await ensureRowDocumentView(workspaceId, documentId, {
                  database_id: databaseId,
                  database_view_id: databaseViewId,
                  row_id: rowId,
                });
                const name = title.trim();

                if (name) {
                  await syncRowDocumentViewName(workspaceId, documentId, name);
                }

                await PageService.moveToTrash(workspaceId, documentId);
              } catch (e) {
                Log.error('[useTrashAwareDeleteRowsDispatch] move row page to trash failed', {
                  rowId,
                  documentId,
                  error: e,
                });
              }
            }
          })();
        } else {
          Log.error('[useTrashAwareDeleteRowsDispatch] missing ids for trash call', {
            workspaceId,
            databaseId,
            databaseViewId,
          });
        }
      }

      if (hardTargets.length > 0) {
        removeRowsFromDatabase(sharedRoot, database, hardTargets);
      }
    },
    [activeViewId, database, databaseDoc.guid, databasePageId, ensureRow, rowMap, sharedRoot, workspaceId]
  );
}

export function useNewRowDispatch() {
  const database = useDatabase();
  const createRow = useCreateRow();
  const guid = useDocGuid();
  const viewId = useDatabaseViewId();
  const currentView = useDatabaseView();
  const layout = useDatabaseViewLayout();
  const isCalendar = layout === DatabaseViewLayout.Calendar;
  const calendarSetting = useCalendarLayoutSetting();
  const filters = currentView?.get(YjsDatabaseKey.filters);
  const {
    navigateToRow,
    databaseDoc,
    loadView,
    loadViewMeta,
    getViewIdFromDatabaseId,
    bindViewSync,
    loadRowDocument,
    workspaceId,
    readOnly,
    canWrite,
  } = useDatabaseContext();
  const rowMap = useRowMap();
  const currentUser = useCurrentUserOptional();
  const actorUid = resolveUserAttributionUid(currentUser);
  const ownerRef = useRef({ databaseDoc, viewId, workspaceId, readOnly, canWrite });
  const mountedRef = useRef(true);

  ownerRef.current = { databaseDoc, viewId, workspaceId, readOnly, canWrite };
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return useCallback(
    async ({
      beforeRowId,
      cellsData,
      tailing = false,
      historyGroup,
      templateId,
      skipDefaultTemplate = false,
      openAfterCreate = false,
      draft,
      suppressAutoOpen = false,
    }: {
      beforeRowId?: string;
      cellsData?: NewRowCellsData;
      /** Publish an edited local draft with its original identity and raw cells. */
      draft?: { id: string; cells: YDatabaseCells; meta: Y.Map<unknown> };
      /** The calendar draft already owns its editor, including under filters. */
      suppressAutoOpen?: boolean;
      tailing?: boolean;
      historyGroup?: object;
      /** Explicit template selection. An unknown id is an error, matching Desktop. */
      templateId?: string;
      /** Bypass the configured default while preserving normal row creation. */
      skipDefaultTemplate?: boolean;
      /** Open the new row after it and any template document have been materialized. */
      openAfterCreate?: boolean;
    }) => {
      if (isDatabaseHistoryDocumentImmutable(databaseDoc)) return null;
      const version = databaseDoc.version;
      const restoreId = databaseDoc.databaseRestoreId;
      const assertCurrent = () => {
        const current = ownerRef.current;

        if (
          !mountedRef.current ||
          current.databaseDoc !== databaseDoc ||
          current.viewId !== viewId ||
          current.workspaceId !== workspaceId ||
          current.readOnly ||
          current.canWrite === false ||
          databaseDoc.version !== version ||
          databaseDoc.databaseRestoreId !== restoreId ||
          isDatabaseHistoryDocumentImmutable(databaseDoc)
        ) {
          throw new Error('This database is no longer writable.');
        }
      };

      assertCurrent();

      if (!currentView) {
        throw new Error('Current view not found');
      }

      if (!createRow) {
        throw new Error('No createRow function');
      }

      const templateState = readDatabaseRowTemplateState(database);
      const selectedTemplateId = templateId || (skipDefaultTemplate ? undefined : templateState.defaultTemplateId);
      const storedTemplate = selectedTemplateId
        ? new DatabaseRowTemplateStore(database).prepareForRowCreation(selectedTemplateId)
        : undefined;

      if (templateId && !storedTemplate) {
        throw new Error('templateId does not match any row template');
      }

      // Decode before creating even an unpublished row. Snapshot bytes are
      // authoritative when legacy isDocumentEmpty metadata is stale.
      const documentSnapshot = decodeTemplateDocumentSnapshot(storedTemplate?.documentData);
      const effectiveTemplate =
        storedTemplate && documentSnapshot
          ? { ...storedTemplate, isDocumentEmpty: documentSnapshot.isDocumentEmpty }
          : storedTemplate;
      const templatePromise = (async () => {
        if (!effectiveTemplate) return undefined;

        // Older Desktop templates stored decorations only on the orphan view.
        // Missing fields retain that fallback; empty strings explicitly clear it.
        if (templateDecorationsNeedResolution(effectiveTemplate) && effectiveTemplate.docViewId && loadViewMeta) {
          try {
            const templateView = await loadViewMeta(effectiveTemplate.docViewId);
            const resolvedTemplate = mergeTemplateViewDecorations(effectiveTemplate, templateView);

            return resolvedTemplate;
          } catch (error) {
            Log.warn('[useNewRowDispatch] failed to resolve template view decorations', {
              templateId: effectiveTemplate.templateId,
              error,
            });
          }
        }

        return effectiveTemplate;
      })();

      const rowId = draft?.id ?? uuidv4();

      // A reciprocal-link failure may occur after publication. A retry still
      // applies the latest draft and repairs links, without duplicating the row.
      const alreadyPublished =
        !!draft &&
        currentView
          .get(YjsDatabaseKey.row_orders)
          .toArray()
          .some((row) => row.id === rowId);
      const rowKey = getRowKey(guid, rowId);
      const selectedTemplate = await templatePromise;

      assertCurrent();
      // A new row has no provider, IndexedDB record, or membership until the server commits.
      // An already published calendar draft is an ordinary edit on retry, not a second create.
      const rowDoc = alreadyPublished ? await createRow(rowKey) : (new Y.Doc({ guid: rowId }) as YDoc);
      let committed = alreadyPublished;

      try {
        assertCurrent();
        // Snapshot the filter array once: Y.Array.toArray() allocates a fresh
        // JS array on each call, and we read it twice (length check + forEach).
        const hasActiveFilters = (filters?.length ?? 0) > 0;
        // Open the row detail page whenever filters are active so the user can
        // see and complete the new row (its primary "Name" cell is always empty,
        // and other cells get pre-filled from filters but still need user input).
        let shouldOpenRowModal = hasActiveFilters;
        // Relation prefills are written synchronously in the transact below, but
        // their reciprocal/back-link updates must run async after the row exists.
        // Keyed by fieldId so multiple filters on the same relation field don't
        // queue conflicting backfills — only the LAST filter's IDs survive in
        // the cell (cells.set overwrites), and the reciprocal updates must
        // mirror that final state, not every intermediate write.
        const relationPrefills = new Map<FieldId, string[]>();

        rowDoc.transact(() => {
          initialDatabaseRow(rowId, database.get(YjsDatabaseKey.id), rowDoc, actorUid);
          const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
          const row = rowSharedRoot.get(YjsEditorKey.database_row);
          const meta = rowSharedRoot.get(YjsEditorKey.meta);

          const prefill = populateNewRowCells({
            row,
            database,
            filters,
            template: selectedTemplate,
            cellsData,
            initialCells: draft?.cells,
            calendarFieldId: isCalendar ? calendarSetting?.fieldId : undefined,
          });

          shouldOpenRowModal = prefill.shouldOpenRowModal;
          prefill.relationPrefills.forEach((ids, fieldId) => relationPrefills.set(fieldId, ids));

          const newMeta = generateRowMeta(rowId, {
            [RowMetaKey.IsDocumentEmpty]: selectedTemplate?.isDocumentEmpty ?? true,
            [RowMetaKey.IconId]: selectedTemplate?.icon ?? null,
            [RowMetaKey.CoverId]: selectedTemplate?.cover ?? null,
          });

          Object.keys(newMeta).forEach((key) => {
            const value = newMeta[key];

            if (value !== undefined && value !== null) {
              meta.set(key, value);
            }
          });
          draft?.meta.forEach((value, key) => meta.set(key, value));
        });

        if (!alreadyPublished) {
          let documentState: Uint8Array | undefined;

          if (selectedTemplate && !selectedTemplate.isDocumentEmpty) {
            const sourceDocument = documentSnapshot
              ? undefined
              : getCachedRowSubDoc(selectedTemplate.docViewId) ??
                getCachedProviderDoc(selectedTemplate.docViewId) ??
                (await loadRowDocument?.(selectedTemplate.docViewId));

            assertCurrent();
            documentState = documentSnapshot
              ? fromBase64(documentSnapshot.encodedState)
              : sourceDocument
              ? Y.encodeStateAsUpdate(sourceDocument)
              : undefined;
            if (!documentState) throw new Error('Template document is unavailable');
          }

          if (!workspaceId) throw new Error('A workspace is required to create a row');
          await createCloudRow({
            workspaceId,
            databaseId: database.get(YjsDatabaseKey.id),
            databaseDoc,
            sourceViewId: viewId,
            rowId,
            rowDoc,
            rowKey,
            position: tailing
              ? { kind: 'end' }
              : beforeRowId
              ? { kind: 'after', row_id: beforeRowId }
              : { kind: 'start' },
            assertCurrent,
            registerRow: () => createRow(rowKey),
            template: selectedTemplate,
            documentState,
            historyGroup,
          });
          committed = true;
        }

        assertCurrent();

        if ((!suppressAutoOpen && shouldOpenRowModal) || openAfterCreate) {
          navigateToRow?.(rowId);
        }

        // Backfill reciprocal links for two-way relations seeded from filter prefills.
        // Done after row creation so related row docs can be loaded asynchronously.
        // Independent prefills on different fields are processed in parallel.
        await Promise.all(
          Array.from(relationPrefills, ([fieldId, rowIds]) =>
            applyRelationReciprocalInserts({
              sourceRowId: rowId,
              sourceFieldId: fieldId,
              insertedRowIds: rowIds,
              database,
              databaseDoc,
              rowMap,
              createRow,
              loadView,
              getViewIdFromDatabaseId,
              bindViewSync,
              actorUid,
              assertCurrent,
            })
          )
        );
        assertCurrent();

        if (isCalendar && shouldOpenRowModal && !suppressAutoOpen) {
          return null;
        }

        return rowId;
      } catch (error) {
        // Relation follow-up is an ordinary edit after creation committed. A
        // failure must not invite a second create with a different row identity.
        if (committed) throw new CommittedRowActivationError(rowId, error);
        throw error;
      } finally {
        if (!alreadyPublished) rowDoc.destroy();
      }
    },
    [
      bindViewSync,
      calendarSetting,
      actorUid,
      createRow,
      currentView,
      database,
      databaseDoc,
      filters,
      getViewIdFromDatabaseId,
      guid,
      isCalendar,
      loadView,
      loadViewMeta,
      loadRowDocument,
      navigateToRow,
      rowMap,
      workspaceId,
      viewId,
    ]
  );
}

export function useDuplicateRowDispatch() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
  const createRow = useCreateRow();
  const guid = useDocGuid();
  const rowMap = useRowMap();
  const { databaseDoc, workspaceId, activeViewId, readOnly, canWrite, loadRowDocument } = useDatabaseContext();
  const currentUser = useCurrentUserOptional();
  const actorUid = resolveUserAttributionUid(currentUser);
  const ownerRef = useRef({ databaseDoc, workspaceId, activeViewId, readOnly, canWrite });
  const mounted = useRef(true);

  ownerRef.current = { databaseDoc, workspaceId, activeViewId, readOnly, canWrite };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return useCallback(
    async (referenceRowId: string) => {
      const assertCurrent = () => {
        const owner = ownerRef.current;

        if (
          !mounted.current ||
          owner.databaseDoc !== databaseDoc ||
          owner.workspaceId !== workspaceId ||
          owner.activeViewId !== activeViewId ||
          owner.readOnly ||
          owner.canWrite === false ||
          isDatabaseHistoryDocumentImmutable(databaseDoc)
        )
          throw new Error('This database is no longer writable.');
      };

      assertCurrent();
      const reference = rowMap?.[referenceRowId];

      if (!reference || !createRow || !workspaceId) throw new Error('Source Row is unavailable');
      const sourceRoot = reference.getMap(YjsEditorKey.data_section) as YSharedRoot;
      const referenceCells = sourceRoot.get(YjsEditorKey.database_row).get(YjsDatabaseKey.cells);
      const sourceMeta = getMetaJSON(referenceRowId, sourceRoot.get(YjsEditorKey.meta));
      const rowId = uuidv4();
      const historyGroup = createDatabaseHistoryGroup();
      const rowKey = getRowKey(guid, rowId);
      const rowDoc = new Y.Doc({ guid: rowId }) as YDoc;
      const databaseId = database.get(YjsDatabaseKey.id);
      let committed = false;

      try {
        initialDatabaseRow(rowId, databaseId, rowDoc, actorUid);
        const root = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
        const cells = root.get(YjsEditorKey.database_row).get(YjsDatabaseKey.cells);
        const fields = database.get(YjsDatabaseKey.fields);

        referenceCells.forEach((cell, fieldId) => {
          const field = fields.get(fieldId);

          if (!field) return;
          const type = Number(field.get(YjsDatabaseKey.type));

          if (!isAttributionFieldType(type)) cells.set(fieldId, cloneDatabaseCell(type, cell as YDatabaseCell));
        });
        let documentState: Uint8Array | undefined;

        const cachedDocument = getCachedRowSubDoc(sourceMeta.documentId) ?? getCachedProviderDoc(sourceMeta.documentId);

        if (
          sourceMeta.isEmptyDocument !== true ||
          (cachedDocument && readTemplateDocumentEmptiness(cachedDocument) === false)
        ) {
          const sourceDoc =
            cachedDocument && readTemplateDocumentEmptiness(cachedDocument) === false
              ? cachedDocument
              : await loadRowDocument?.(sourceMeta.documentId, {
                  requireServerFetch: true,
                  rowDocumentSource: {
                    database_id: databaseId,
                    database_view_id: activeViewId,
                    row_id: referenceRowId,
                  },
                });

          assertCurrent();
          if (!sourceDoc) throw new Error('Source Row document is unavailable');
          const empty = readTemplateDocumentEmptiness(sourceDoc);

          if (empty === undefined) throw new Error('Source Row document is incomplete');
          if (empty && sourceMeta.isEmptyDocument === false) throw new Error('Source Row document is still empty');
          if (!empty) documentState = Y.encodeStateAsUpdate(sourceDoc);
        }

        const metadata = generateRowMeta(rowId, {
          [RowMetaKey.IsDocumentEmpty]: !documentState,
          [RowMetaKey.IconId]: sourceMeta.icon,
          [RowMetaKey.CoverId]: sourceMeta.cover ? JSON.stringify(sourceMeta.cover) : null,
        });

        Object.entries(metadata).forEach(([key, value]) => {
          if (value !== undefined && value !== null) root.get(YjsEditorKey.meta).set(key, value);
        });
        // The same complete graph builder handles a live source document and its
        // embedded databases. No local membership or legacy copy is published first.
        await createCloudRow({
          workspaceId,
          databaseId,
          databaseDoc,
          sourceViewId: activeViewId,
          rowId,
          rowKey,
          rowDoc,
          position: { kind: 'after', row_id: referenceRowId },
          assertCurrent,
          registerRow: () => createRow(rowKey),
          documentState,
          historyGroup,
          preserveCellStorage: true,
          template: documentState
            ? {
                templateId: referenceRowId,
                name: '',
                docViewId: sourceMeta.documentId,
                isDocumentEmpty: false,
                embeddedDatabases: [],
                defaultCells: {},
                createdAtMs: 0,
                updatedAtMs: 0,
              }
            : undefined,
        });
        committed = true;
        assertCurrent();
        executeOperationWithAllViews(
          sharedRoot,
          database,
          (view) => duplicateTimelineRowDependencyLinks(view, referenceCells, referenceRowId, rowId),
          'duplicateRowDispatch',
          historyGroup
        );
        return rowId;
      } catch (error) {
        if (committed) throw new CommittedRowActivationError(rowId, error);
        throw error;
      } finally {
        rowDoc.destroy();
      }
    },
    [activeViewId, actorUid, createRow, database, databaseDoc, guid, loadRowDocument, rowMap, sharedRoot, workspaceId]
  );
}

export function useUpdateRowMetaDispatch(rowId: string) {
  const rowMap = useRowMap();
  const { databaseDoc } = useDatabaseContext();
  const currentUser = useCurrentUserOptional();
  const actorUid = resolveUserAttributionUid(currentUser);

  // Store rowMap in a ref so the callback always gets the latest value
  // This fixes a bug where rowDoc might not be in the map when the hook is first called,
  // but is added later when the row document loads asynchronously
  const rowMapRef = useRef(rowMap);

  useEffect(() => {
    rowMapRef.current = rowMap;
  });

  return useCallback(
    (key: RowMetaKey, value?: string | boolean) => {
      // Get rowDoc from the ref to always use the latest map
      const rowDoc = rowMapRef.current?.[rowId];

      if (!rowDoc) {
        console.warn(`[useUpdateRowMetaDispatch] Row not found: ${rowId}`);
        return;
      }

      const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
      const meta = rowSharedRoot.get(YjsEditorKey.meta);

      const keyId = getMetaIdMap(rowId).get(key);

      if (!keyId) {
        throw new Error(`Meta key not found: ${key}`);
      }

      const isDifferent = meta.get(keyId) !== value;

      if (!isDifferent) {
        return;
      }

      const policy = key === RowMetaKey.IconId || key === RowMetaKey.CoverId ? 'capture' : 'skip';

      registerDatabaseHistoryRowDoc(databaseDoc, rowId, rowDoc);
      runDatabaseRowAction(rowDoc, { type: 'row.update-meta', rowId, policy }, () => {
        if (value === undefined) {
          meta.delete(keyId);
        } else {
          meta.set(keyId, value);
        }

        const row = rowSharedRoot.get(YjsEditorKey.database_row);

        if (row) touchRowAttribution(row, actorUid);
      });
    },
    [actorUid, databaseDoc, rowId]
  );
}
