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
import { useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import * as Y from 'yjs';

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
import { FieldType, FilterType, RowMetaKey } from '@/application/database-yjs/database.type';
import { createCheckboxCell } from '@/application/database-yjs/fields/checkbox/utils';
import { parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { RelationLimit } from '@/application/database-yjs/fields/relation/relation.type';
import { createSelectOptionCell } from '@/application/database-yjs/fields/select-option/utils';
import {
  dateFilterFillData,
  filterFillData,
  getFilterChildren,
  normalizeFilterNode,
  relationFilterFillData,
} from '@/application/database-yjs/filter';
import { normalizeGroupIdentifiers } from '@/application/database-yjs/group';
import { initialDatabaseRow } from '@/application/database-yjs/row';
import { generateRowMeta, getMetaIdMap, getMetaJSON, getRowKey } from '@/application/database-yjs/row_meta';
import { useDatabaseViewLayout, useCalendarLayoutSetting, getPrimaryFieldId } from '@/application/database-yjs/selector';
import {
  applyTemplateCellsToRow,
  DatabaseRowTemplateStore,
  initializeTemplateSourceRow,
  mergeTemplateViewDecorations,
  readDatabaseRowTemplateState,
  templateDecorationsNeedResolution,
} from '@/application/database-yjs/template';
import { deleteCollabDB, getCachedProviderDoc, openCollabDB } from '@/application/db';
import {
  ensureRowDocumentView,
  rowDocumentExists,
  rowDocumentIdFromRowId,
  syncRowDocumentViewName,
} from '@/application/row-document/lifecycle';
import { PageService } from '@/application/services/domains';
import { getCachedRowSubDoc } from '@/application/services/js-services/cache';
import { executeOperations } from '@/application/slate-yjs/utils/yjs';
import { deleteOutboxByObjectId } from '@/application/sync-outbox';
import {
  BlockType,
  DatabaseViewLayout,
  FieldId,
  YDatabaseCell,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseRow,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';
import { Log } from '@/utils/log';

import { applyRelationReciprocalInserts } from './relation';
import { removeRowsFromDatabase, softDeleteRowsInDatabase } from './row-lifecycle';
import { executeOperationWithAllViews } from './utils';

export function collectNewRowPrefillFilters(filters: YDatabaseFilters | undefined): YDatabaseFilter[] {
  if (!filters) return [];

  const leaves: YDatabaseFilter[] = [];
  const visit = (rawNode: unknown) => {
    const node = normalizeFilterNode(rawNode);

    if (!node) return;

    const rawType = node.get(YjsDatabaseKey.filter_type);
    const parsedType = Number(rawType);
    const type =
      rawType === undefined || rawType === null || !Number.isFinite(parsedType) ? FilterType.Data : parsedType;

    if (type === FilterType.Data) {
      leaves.push(node);
      return;
    }

    const children = getFilterChildren(node);

    if (type === FilterType.And) {
      children.forEach(visit);
      return;
    }

    if (type === FilterType.Or && children.length > 0) {
      visit(children[0]);
    }
  };

  filters.toArray().forEach(visit);
  return leaves;
}

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

export function useMoveCardDispatch() {
  const view = useDatabaseView();
  const sharedRoot = useSharedRoot();
  const rowMap = useRowMap();
  const database = useDatabase();

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
      executeOperations(
        sharedRoot,
        [
          () => {
            if (!view) {
              throw new Error(`Unable to reorder card`);
            }

            const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

            if (!field) {
              throw new Error(`Field not found`);
            }

            const fieldType = Number(field.get(YjsDatabaseKey.type));

            const rowDoc = rowMap?.[rowId];

            if (!rowDoc) {
              throw new Error(`Unable to reorder card`);
            }

            const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

            const cells = row.get(YjsDatabaseKey.cells);
            const isSelectOptionField = [FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType);

            let cell = cells.get(fieldId);

            if (!cell) {
              // if the cell is empty, create a new cell and set data to finishColumnId
              if (isSelectOptionField) {
                cell = createSelectOptionCell(fieldId, fieldType, finishColumnId);
              } else if (fieldType === FieldType.Checkbox) {
                cell = createCheckboxCell(fieldId, finishColumnId);
              }

              cells.set(fieldId, cell);
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

              cell.set(YjsDatabaseKey.data, newCellData);
              setCellStoredType(cell, fieldType);
              cell.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
              row.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
            }

            reorderRow(rowId, beforeRowId, view);
          },
        ],
        'reorderCard'
      );
    },
    [database, rowMap, sharedRoot, view]
  );
}

export function useDeleteRowDispatch() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();

  return useCallback(
    (rowId: string) => {
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
    (rowIds: string[]) => {
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
        'bulkDeleteRowDispatch'
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

function markRowDocumentEmpty(rowDoc: YDoc, rowId: string) {
  rowDoc.transact(() => {
    const fallbackMeta = generateRowMeta(rowId, {
      [RowMetaKey.IsDocumentEmpty]: true,
    });
    const meta = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.meta) as Y.Map<unknown>;

    Object.entries(fallbackMeta).forEach(([key, value]) => meta.set(key, value));
  }, 'database-row-template-fallback');
}

export function useNewRowDispatch() {
  const database = useDatabase();
  const sharedRoot = useSharedRoot();
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
    createRowDocument,
    duplicateRowDocument,
  } = useDatabaseContext();
  const rowMap = useRowMap();

  return useCallback(
    async ({
      beforeRowId,
      cellsData,
      tailing = false,
      templateId,
      skipDefaultTemplate = false,
      openAfterCreate = false,
    }: {
      beforeRowId?: string;
      cellsData?: Record<
        FieldId,
        | string
        | {
            data: string;
            endTimestamp?: string;
            isRange?: boolean;
            includeTime?: boolean;
            reminderId?: string;
          }
      >;
      tailing?: boolean;
      /** Explicit template selection. An unknown id is an error, matching Desktop. */
      templateId?: string;
      /** Bypass the configured default while preserving normal row creation. */
      skipDefaultTemplate?: boolean;
      /** Open the new row after it and any template document have been materialized. */
      openAfterCreate?: boolean;
    }) => {
      if (!currentView) {
        throw new Error('Current view not found');
      }

      if (!createRow) {
        throw new Error('No createRow function');
      }

      const templateState = readDatabaseRowTemplateState(database);
      const selectedTemplateId = templateId || (skipDefaultTemplate ? undefined : templateState.defaultTemplateId);
      const storedTemplate = selectedTemplateId
        ? templateState.templates.find((template) => template.templateId === selectedTemplateId)
        : undefined;

      if (templateId && !storedTemplate) {
        throw new Error('templateId does not match any row template');
      }

      const templatePromise = (async () => {
        if (!storedTemplate) return undefined;

        // Desktop stores template decorations on the orphan document view
        // rather than in RowTemplatePB. Resolve that fallback so templates
        // authored by either client create the same row metadata.
        if (templateDecorationsNeedResolution(storedTemplate) && storedTemplate.docViewId && loadViewMeta) {
          try {
            const templateView = await loadViewMeta(storedTemplate.docViewId);
            const resolvedTemplate = mergeTemplateViewDecorations(storedTemplate, templateView);

            return resolvedTemplate === storedTemplate
              ? storedTemplate
              : new DatabaseRowTemplateStore(database).upsert(resolvedTemplate);
          } catch (error) {
            Log.warn('[useNewRowDispatch] failed to resolve template view decorations', {
              templateId: storedTemplate.templateId,
              error,
            });
          }
        }

        return storedTemplate;
      })();

      const rowId = uuidv4();
      const rowKey = getRowKey(guid, rowId);
      const [selectedTemplate, rowDoc] = await Promise.all([templatePromise, createRow(rowKey)]);
      // Snapshot the filter array once: Y.Array.toArray() allocates a fresh
      // JS array on each call, and we read it twice (length check + forEach).
      const hasActiveFilters = (filters?.length ?? 0) > 0;
      const filterArray = collectNewRowPrefillFilters(filters);
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
        initialDatabaseRow(rowId, database.get(YjsDatabaseKey.id), rowDoc);
        const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
        const row = rowSharedRoot.get(YjsEditorKey.database_row);
        const meta = rowSharedRoot.get(YjsEditorKey.meta);

        const cells = row.get(YjsDatabaseKey.cells);

        if (selectedTemplate) {
          const appliedCells = applyTemplateCellsToRow(row, database, selectedTemplate.defaultCells);

          // Template relation defaults join the same reciprocal-backfill queue
          // as filter prefills. A later filter prefill on the same field
          // overwrites both the cell and this queue entry, so the backfill
          // always mirrors the final cell state.
          Object.entries(appliedCells).forEach(([fieldId, value]) => {
            if (value.type === 'relation' && value.value.length > 0) {
              relationPrefills.set(fieldId, value.value);
            }
          });
        }

        filterArray.forEach((filter) => {
          const cell = new Y.Map() as YDatabaseCell;
          const fieldId = filter.get(YjsDatabaseKey.field_id);
          const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

          if (!field) {
            return;
          }

          // Desktop deliberately leaves the primary title empty when a row is
          // created under an active filter. The filtered-out row is completed
          // through the row detail page; secondary fields can still inherit
          // their filter values.
          if (field.get(YjsDatabaseKey.is_primary)) {
            return;
          }

          if (isCalendar && calendarSetting?.fieldId === fieldId) {
            shouldOpenRowModal = true;
          }

          const type = Number(field.get(YjsDatabaseKey.type));

          if (type === FieldType.DateTime) {
            const { data, endTimestamp, isRange } = dateFilterFillData(filter);

            if (data !== null) {
              cell.set(YjsDatabaseKey.data, data);
            }

            if (endTimestamp) {
              cell.set(YjsDatabaseKey.end_timestamp, endTimestamp);
            }

            if (isRange) {
              cell.set(YjsDatabaseKey.is_range, isRange);
            }
          } else if ([FieldType.CreatedTime, FieldType.LastEditedTime].includes(type)) {
            shouldOpenRowModal = true;
            return;
          } else if (type === FieldType.Relation) {
            const rowIds = relationFilterFillData(
              String(filter.get(YjsDatabaseKey.content) ?? ''),
              Number(filter.get(YjsDatabaseKey.condition))
            );

            if (!rowIds) {
              return;
            }

            // Enforce source_limit synchronously so OneOnly relations don't
            // silently end up with multiple linked rows when the filter has
            // several values selected.
            const typeOption = parseRelationTypeOption(field);
            const limitedRowIds =
              typeOption.source_limit === RelationLimit.OneOnly && rowIds.length > 1
                ? [rowIds[rowIds.length - 1]]
                : rowIds;

            const data = new Y.Array<string>();

            if (limitedRowIds.length > 0) {
              data.push([...limitedRowIds]);
              relationPrefills.set(fieldId, limitedRowIds);
            } else {
              // An earlier filter on this same field may have queued IDs;
              // an empty later filter must clear that queue so the backfill
              // doesn't write reciprocals to rows the source no longer links.
              relationPrefills.delete(fieldId);
            }

            cell.set(YjsDatabaseKey.data, data);
          } else {
            const data = filterFillData(filter, field);

            if (data === null) {
              return;
            }

            cell.set(YjsDatabaseKey.data, data);
          }

          cell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
          cell.set(YjsDatabaseKey.field_type, type);

          cells.set(fieldId, cell);
        });

        if (cellsData) {
          Object.entries(cellsData).forEach(([fieldId, data]) => {
            const cell = new Y.Map() as YDatabaseCell;
            const field = database.get(YjsDatabaseKey.fields)?.get(fieldId);

            if (!field) return;

            // The raw cell payload replaces whatever a template or filter
            // wrote for this field, so any queued reciprocal backfill for it
            // would no longer match the final cell state.
            relationPrefills.delete(fieldId);

            const type = Number(field.get(YjsDatabaseKey.type));
            const rawData = typeof data === 'object' ? data.data : data;

            cell.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
            cell.set(YjsDatabaseKey.field_type, type);

            if (type === FieldType.Relation) {
              const relationOption = parseRelationTypeOption(field);
              const identifiers = normalizeGroupIdentifiers(rawData);
              const rowIds =
                relationOption.source_limit === RelationLimit.OneOnly && identifiers.length > 1
                  ? [identifiers[identifiers.length - 1]]
                  : identifiers;
              const relationData = new Y.Array<string>();

              if (rowIds.length > 0) {
                relationData.push(rowIds);
                relationPrefills.set(fieldId, rowIds);
              }

              cell.set(YjsDatabaseKey.data, relationData);
            } else if (typeof data === 'object') {
              cell.set(YjsDatabaseKey.data, data.data);
              cell.set(YjsDatabaseKey.end_timestamp, data.endTimestamp);
              cell.set(YjsDatabaseKey.is_range, data.isRange);
              cell.set(YjsDatabaseKey.include_time, data.includeTime);
              cell.set(YjsDatabaseKey.reminder_id, data.reminderId);
            } else {
              cell.set(YjsDatabaseKey.data, data);
            }

            cells.set(fieldId, cell);
          });
        }

        row.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));

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
      });

      executeOperationWithAllViews(
        sharedRoot,
        database,
        (view, id) => {
          const rowOrders = view.get(YjsDatabaseKey.row_orders);

          if (!rowOrders) {
            throw new Error(`Row orders not found`);
          }

          const row = {
            id: rowId,
            height: 36,
          };

          const index = beforeRowId ? rowOrders.toArray().findIndex((row) => row.id === beforeRowId) + 1 : 0;

          if ((viewId !== id && index === -1) || tailing) {
            rowOrders.push([row]);
          } else {
            rowOrders.insert(index, [row]);
          }
        },
        'newRowDispatch'
      );

      if (selectedTemplate && !selectedTemplate.isDocumentEmpty) {
        if (!duplicateRowDocument) {
          markRowDocumentEmpty(rowDoc, rowId);
          Log.warn('[useNewRowDispatch] template document duplication is unavailable', {
            templateId: selectedTemplate.templateId,
          });
        } else {
          try {
            // A template is represented as a hidden row collab. It deliberately
            // never enters row_orders, but gives the existing cloud duplication
            // pipeline a stable source identity and preserves inline-vs-linked
            // database semantics.
            const cachedSourceDocument =
              getCachedRowSubDoc(selectedTemplate.docViewId) ?? getCachedProviderDoc(selectedTemplate.docViewId);
            const sourceDocumentPromise = cachedSourceDocument
              ? Promise.resolve(cachedSourceDocument)
              : loadRowDocument
              ? loadRowDocument(selectedTemplate.docViewId)
              : Promise.resolve(null);
            const [sourceRowDoc, sourceDocument] = await Promise.all([
              createRow(getRowKey(guid, selectedTemplate.templateId)),
              sourceDocumentPromise,
            ]);

            initializeTemplateSourceRow(sourceRowDoc, database, selectedTemplate);

            let clientDocStateB64: string | undefined;

            if (sourceDocument) {
              const docState = Y.encodeStateAsUpdate(sourceDocument);
              const chunks: string[] = [];

              for (let index = 0; index < docState.length; index += 8192) {
                chunks.push(String.fromCharCode(...docState.subarray(index, index + 8192)));
              }

              clientDocStateB64 = btoa(chunks.join(''));
            }

            const databaseId = database.get(YjsDatabaseKey.id);
            const sourceDocumentId = rowDocumentIdFromRowId(selectedTemplate.templateId);

            await duplicateRowDocument(databaseId, selectedTemplate.templateId, rowId, clientDocStateB64, async () => {
              await createRowDocument?.(sourceDocumentId, {
                database_id: databaseId,
                database_view_id: viewId,
                row_id: selectedTemplate.templateId,
              });
            });
          } catch (error) {
            // Cell defaults must remain usable if document materialization is
            // temporarily unavailable; this is also Desktop's graceful fallback.
            markRowDocumentEmpty(rowDoc, rowId);
            Log.error('[useNewRowDispatch] template document duplication failed', error);
          }
        }
      }

      if (shouldOpenRowModal || openAfterCreate) {
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
          })
        )
      );

      if (isCalendar && shouldOpenRowModal) {
        return null;
      }

      return rowId;
    },
    [
      bindViewSync,
      calendarSetting,
      createRowDocument,
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
      sharedRoot,
      duplicateRowDocument,
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
  const { duplicateRowDocument } = useDatabaseContext();

  return useCallback(
    async (referenceRowId: string) => {
      const referenceRowDoc = rowMap?.[referenceRowId];

      if (!referenceRowDoc) {
        throw new Error(`Row not found`);
      }

      if (!createRow) {
        throw new Error('No createRow function');
      }

      const referenceRowSharedRoot = referenceRowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
      const referenceRow = referenceRowSharedRoot.get(YjsEditorKey.database_row);
      const referenceCells = referenceRow.get(YjsDatabaseKey.cells);
      const referenceMeta = getMetaJSON(referenceRowId, referenceRowSharedRoot.get(YjsEditorKey.meta));

      const rowId = uuidv4();

      const icon = referenceMeta.icon;
      const cover = referenceMeta.cover;
      const sourceDocId = referenceMeta.documentId;
      const isSourceDocEmpty = referenceMeta.isEmptyDocument === true;
      const isSourceDocNonEmpty = referenceMeta.isEmptyDocument === false;
      const shouldDuplicateSourceDoc = Boolean(sourceDocId) && !isSourceDocEmpty;
      const newMeta = generateRowMeta(rowId, {
        [RowMetaKey.IsDocumentEmpty]: !isSourceDocNonEmpty,
        [RowMetaKey.IconId]: icon,
        [RowMetaKey.CoverId]: cover ? JSON.stringify(cover) : null,
      });

      const rowKey = getRowKey(guid, rowId);
      const rowDoc = await createRow(rowKey);

      rowDoc.transact(() => {
        initialDatabaseRow(rowId, database.get(YjsDatabaseKey.id), rowDoc);

        const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;

        const row = rowSharedRoot.get(YjsEditorKey.database_row);

        const meta = rowSharedRoot.get(YjsEditorKey.meta);

        Object.keys(newMeta).forEach((key) => {
          const value = newMeta[key];

          if (value !== undefined && value !== null) {
            meta.set(key, value);
          }
        });

        const cells = row.get(YjsDatabaseKey.cells);
        const fields = database.get(YjsDatabaseKey.fields);

        Object.keys(referenceCells.toJSON()).forEach((fieldId) => {
          try {
            const referenceCell = referenceCells.get(fieldId);

            if (!referenceCell) {
              throw new Error(`Cell not found`);
            }

            const fieldType = Number(fields.get(fieldId)?.get(YjsDatabaseKey.type));

            const cell = cloneDatabaseCell(fieldType, referenceCell);

            cells.set(fieldId, cell);
          } catch (e) {
            console.error(e);
          }
        });

        row.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
      });

      executeOperationWithAllViews(
        sharedRoot,
        database,
        (view) => {
          const rowOrders = view.get(YjsDatabaseKey.row_orders);

          if (!rowOrders) {
            throw new Error(`Row orders not found`);
          }

          const row = {
            id: rowId,
            height: 36,
          };

          const referenceIndex = rowOrders.toArray().findIndex((row) => row.id === referenceRowId);
          const targetIndex = referenceIndex + 1;

          if (targetIndex >= rowOrders.length) {
            rowOrders.push([row]);
            return;
          }

          rowOrders.insert(targetIndex, [row]);
        },
        'duplicateRowDispatch'
      );

      // Ask the server to duplicate the row document with inline database
      // deep copy. Send the client's current doc state so the worker has
      // the latest content even if WebSocket sync hasn't persisted yet.
      if (duplicateRowDocument) {
        const databaseId = database.get(YjsDatabaseKey.id);

        try {
          let clientDocStateB64: string | undefined;
          let hasClientDocumentContent = false;

          if (shouldDuplicateSourceDoc) {
            // Find a Y.Doc with actual content. Check in priority order:
            //   1. Dialog sub-doc cache (rowSubDocs) — populated when user
            //      opens the row in dialog mode.
            //   2. Provider cache (providerCache) — populated when user opens
            //      the row in full-page mode.
            //   3. IndexedDB — durable y-indexeddb store. Survives cache
            //      eviction and deferred cleanup.
            // Any of these may be an empty shell (doc structure but no
            // content) if the user typed in a different mode, so we validate
            // content at each step and fall through if empty.
            const hasMeaningfulContent = (doc: YDoc | undefined): boolean => {
              if (!doc) return false;
              const root = doc.getMap(YjsEditorKey.data_section);
              const document = root?.get(YjsEditorKey.document) as Y.Map<unknown> | undefined;
              const meta = document?.get(YjsEditorKey.meta) as Y.Map<unknown> | undefined;
              const textMap = meta?.get(YjsEditorKey.text_map) as Y.Map<Y.Text> | undefined;

              if (textMap) {
                for (const text of textMap.values()) {
                  if (text?.toString().length) {
                    return true;
                  }
                }
              }

              const blocks = document?.get(YjsEditorKey.blocks) as Y.Map<unknown> | undefined;

              if (!blocks) return false;

              for (const block of blocks.values()) {
                if (!(block instanceof Y.Map)) {
                  return true;
                }

                const blockType = block.get(YjsEditorKey.block_type);

                if (blockType && blockType !== BlockType.Page && blockType !== BlockType.Paragraph) {
                  return true;
                }
              }

              return false;
            };

            let cachedDoc: YDoc | undefined = getCachedRowSubDoc(sourceDocId);

            if (!hasMeaningfulContent(cachedDoc)) {
              cachedDoc = getCachedProviderDoc(sourceDocId);
            }

            if (!hasMeaningfulContent(cachedDoc)) {
              try {
                cachedDoc = await openCollabDB(sourceDocId);
              } catch (e) {
                Log.warn('[duplicateRowDocument] openCollabDB fallback failed', { sourceDocId, error: e });
              }
            }

            hasClientDocumentContent = hasMeaningfulContent(cachedDoc);

            if (cachedDoc && hasClientDocumentContent) {
              const docState = Y.encodeStateAsUpdate(cachedDoc);
              // Convert to base64 for the server (chunked to avoid stack overflow on large docs)
              const CHUNK = 8192;
              const chunks: string[] = [];

              for (let i = 0; i < docState.length; i += CHUNK) {
                chunks.push(String.fromCharCode(...docState.subarray(i, i + CHUNK)));
              }

              clientDocStateB64 = btoa(chunks.join(''));

              // If we found a cached doc with content, ensure the duplicated
              // row's meta marks the document as non-empty so the client
              // fetches from the server when the row is opened.
              if (!isSourceDocNonEmpty) {
                rowDoc.transact(() => {
                  const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
                  const meta = rowSharedRoot.get(YjsEditorKey.meta);
                  const isEmptyKey = getMetaIdMap(rowId).get(RowMetaKey.IsDocumentEmpty) ?? '';

                  if (isEmptyKey) {
                    meta.set(isEmptyKey, false);
                  }
                });
              }
            }
          }

          if (shouldDuplicateSourceDoc || hasClientDocumentContent) {
            await duplicateRowDocument(databaseId, referenceRowId, rowId, clientDocStateB64);
          }
        } catch (err) {
          Log.error('[duplicateRowDocument] failed:', err);
        }
      }

      return rowId;
    },
    [createRow, database, guid, rowMap, sharedRoot, duplicateRowDocument]
  );
}

export function useUpdateRowMetaDispatch(rowId: string) {
  const rowMap = useRowMap();

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

      rowDoc.transact(() => {
        if (value === undefined) {
          meta.delete(keyId);
        } else {
          meta.set(keyId, value);
        }
      });
    },
    [rowId]
  );
}
