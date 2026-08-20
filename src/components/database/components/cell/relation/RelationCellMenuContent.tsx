import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getPrimaryFieldId, useDatabaseContext } from '@/application/database-yjs';
import { resolveUserAttributionUid } from '@/application/database-yjs/attribution';
import { decodeCellToText } from '@/application/database-yjs/decode';
import { createRowInRelatedDatabase } from '@/application/database-yjs/dispatch/relation';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { subscribeSharedYjsDeep } from '@/application/database-yjs/shared-yjs-observer';
import { View, YDatabase, YDatabaseField, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { ReactComponent as AddIcon } from '@/assets/icons/add_new_page.svg';
import { ReactComponent as MinusIcon } from '@/assets/icons/minus.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import RelationRowItem from '@/components/database/components/cell/relation/RelationRowItem';
import {
  getLiveRelationRowIds,
  getRelationRowOrders,
} from '@/components/database/components/cell/relation/relationRowOrders';
import { useNavigationKey } from '@/components/database/components/cell/relation/useNavigationKey';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { dropdownMenuItemVariants, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { SearchInput } from '@/components/ui/search-input';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const recentRelationRowsByView = new Map<string, string[]>();
const ROW_LOAD_CONCURRENCY = 8;

function rememberRecentRelationRow(viewId: string | undefined, rowId: string) {
  if (!viewId) return;

  const previous = recentRelationRowsByView.get(viewId) ?? [];
  const next = [rowId, ...previous.filter((id) => id !== rowId)].slice(0, 20);

  recentRelationRowsByView.set(viewId, next);
}

function sortByRecentRows(rowIds: string[], viewId: string | undefined) {
  const recentRows = viewId ? recentRelationRowsByView.get(viewId) ?? [] : [];

  if (recentRows.length === 0) return rowIds;

  const originalIndex = new Map(rowIds.map((id, index) => [id, index]));
  const recentIndex = new Map(recentRows.map((id, index) => [id, index]));

  return [...rowIds].sort((left, right) => {
    const leftRecent = recentIndex.get(left);
    const rightRecent = recentIndex.get(right);

    if (leftRecent !== undefined || rightRecent !== undefined) {
      return (leftRecent ?? Number.MAX_SAFE_INTEGER) - (rightRecent ?? Number.MAX_SAFE_INTEGER);
    }

    return (originalIndex.get(left) ?? 0) - (originalIndex.get(right) ?? 0);
  });
}

interface RelationCellMenuContentProps {
  loading?: boolean;
  relationRowIds?: string[];
  selectedView?: View;
  onAddRelationRowId: (rowId: string) => void;
  onRemoveRelationRowId: (rowId: string) => void;
  relatedDatabaseId: string;
  onClose?: () => void;
}

function RelationCellMenuContentForTarget({
  relationRowIds,
  selectedView,
  relatedDatabaseId,
  onAddRelationRowId,
  onRemoveRelationRowId,
  loading,
  onClose,
}: RelationCellMenuContentProps) {
  const { t } = useTranslation();
  const currentUser = useCurrentUserOptional();
  const actorUid = resolveUserAttributionUid(currentUser);
  const { navigateToView, loadView, navigateToRow, createRow, bindViewSync } = useDatabaseContext();
  const [element, setElement] = useState<HTMLElement | null>(null);
  const selectedViewId = selectedView?.view_id;
  const openRelatedRow = useCallback(
    (rowId: string) => {
      onClose?.();
      setTimeout(() => {
        void navigateToRow?.(rowId, selectedViewId);
      }, 0);
    },
    [navigateToRow, onClose, selectedViewId]
  );
  const onToggleSelectedRowId = useCallback(
    (rowId: string) => {
      if (relationRowIds?.includes(rowId)) {
        openRelatedRow(rowId);
      } else {
        rememberRecentRelationRow(selectedViewId, rowId);
        onAddRelationRowId(rowId);
      }
    },
    [onAddRelationRowId, openRelatedRow, relationRowIds, selectedViewId]
  );

  const [searchInput, setSearchInput] = useState<string>('');
  const [primaryFieldId, setPrimaryFieldId] = useState<string | null>(null);
  const [primaryField, setPrimaryField] = useState<YDatabaseField | null>(null);
  const [primaryFieldClock, setPrimaryFieldClock] = useState(0);
  const [guid, setGuid] = useState<string | null>(null);
  const [targetDoc, setTargetDoc] = useState<YDoc | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [rowIds, setRowIds] = useState<string[]>([]);
  // An empty `rowIds` is indistinguishable from a database that genuinely has no rows, and the
  // picker would announce "no result" on the strength of it. Nothing may be concluded from an
  // empty list until this flips.
  const [rowIdsLoaded, setRowIdsLoaded] = useState(false);
  const [rowContents, setRowContents] = useState<Map<string, string>>(() => new Map());
  const rowDocsRef = useRef<Map<string, YDoc>>(new Map());
  const targetDocRef = useRef<YDoc | null>(null);
  const [isCreatingAndLinking, setIsCreatingAndLinking] = useState(false);
  // Synchronous double-tap guard — `isCreatingAndLinking` state is async and a
  // user clicking the footer twice in the same frame can both see the stale
  // `false` closure value. The ref is updated before React commits the
  // disabled state, so the second click bails out unconditionally.
  const isCreatingRef = useRef(false);

  const { selectedId, setSelectedId } = useNavigationKey({
    element,
    onToggleSelectedRowId,
  });

  useEffect(() => {
    const rowDocs = rowDocsRef.current;

    // Switching target database starts the wait over — the previous database's rows say nothing
    // about this one.
    setRowIdsLoaded(false);
    setTargetDoc(null);
    setGuid(null);
    setPrimaryFieldId(null);
    setPrimaryField(null);
    setNoAccess(false);
    setRowIds([]);
    setRowContents(new Map());
    targetDocRef.current = null;
    rowDocs.clear();

    let cancelled = false;

    void (async () => {
      if (!loadView) {
        return;
      }

      if (!selectedViewId) {
        return;
      }

      try {
        const doc = await loadView(selectedViewId, false, false, {
          databaseId: relatedDatabaseId,
          databaseMetadataOnly: true,
        });

        if (cancelled) return;

        targetDocRef.current = doc;
        setGuid(doc.guid);
        setTargetDoc(doc);
      } catch (e) {
        if (cancelled) return;
        // The list will not arrive; stop waiting on it so the picker can settle on "no result"
        // rather than holding placeholders that never resolve.
        setRowIdsLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
      rowDocs.clear();
    };
  }, [loadView, relatedDatabaseId, selectedViewId]);

  // `loadView` hands back the target database doc as soon as it exists locally — its fields and
  // row_orders may still be empty while the first server sync lands. Reading it once left the
  // picker permanently showing "no result" until it was closed and reopened, so keep re-reading
  // it as the doc fills in.
  useEffect(() => {
    if (!targetDoc || !selectedViewId) return;

    const sharedRoot = targetDoc.getMap(YjsEditorKey.data_section);

    const readTargetDatabase = () => {
      const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;

      // Nothing has synced yet: neither "no access" nor "no rows" may be concluded, so stay in
      // the loading state until the database map appears.
      if (!database) return;

      const fieldId = getPrimaryFieldId(database);

      if (!fieldId) {
        setNoAccess(true);
        setRowIdsLoaded(true);
        return;
      }

      setNoAccess(false);
      setPrimaryFieldId(fieldId);
      setPrimaryField(database.get(YjsDatabaseKey.fields)?.get(fieldId) || null);

      const rowOrders = getRelationRowOrders(database, selectedViewId);

      if (!rowOrders) return;

      const ids = getLiveRelationRowIds(rowOrders.toArray());

      setRowIds((previous) =>
        previous.length === ids.length && previous.every((id, index) => id === ids[index]) ? previous : ids
      );
      setRowIdsLoaded(true);
    };

    readTargetDatabase();

    return subscribeSharedYjsDeep(sharedRoot, readTargetDatabase);
  }, [selectedViewId, targetDoc]);

  useEffect(() => {
    if (!primaryField) return;

    const onPrimaryFieldChange = () => {
      setPrimaryFieldClock((clock) => clock + 1);
    };

    primaryField.observeDeep(onPrimaryFieldChange);
    return () => {
      primaryField.unobserveDeep(onPrimaryFieldChange);
    };
  }, [primaryField]);

  const getContent = useCallback(
    (rowId: string) => {
      void primaryFieldClock;

      const rowDoc = rowDocsRef.current.get(rowId);

      if (!rowDoc || !primaryFieldId) {
        return '';
      }

      const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
      const row = rowSharedRoot?.get(YjsEditorKey.database_row) as YDatabaseRow;
      const cell = row?.get(YjsDatabaseKey.cells)?.get(primaryFieldId);

      if (!cell) return '';
      return primaryField ? decodeCellToText(cell, primaryField) : '';
    },
    [primaryFieldId, primaryField, primaryFieldClock]
  );

  // `getContent` changes identity whenever the primary field (or its clock) does. Keeping it in a
  // ref keeps that out of the row-loading effect's dependencies: otherwise a single field edit
  // would tear down every row-doc observer and re-await `createRow` for the whole list.
  const getContentRef = useRef(getContent);

  useEffect(() => {
    getContentRef.current = getContent;
  }, [getContent]);

  const recordContent = useCallback((rowId: string) => {
    setRowContents((prev) => {
      const next = getContentRef.current(rowId);

      if (prev.get(rowId) === next) return prev;

      const newContents = new Map(prev);

      newContents.set(rowId, next);
      return newContents;
    });
  }, []);

  // A primary-field change (rename, type switch, …) only changes how existing row docs decode, so
  // re-read them in place rather than reloading anything. `getContent` is the trigger here, not a
  // call — `recordContent` reads the fresh one off the ref synced above.
  useEffect(() => {
    void getContent;
    rowDocsRef.current.forEach((_doc, rowId) => recordContent(rowId));
  }, [recordContent, getContent]);

  useEffect(() => {
    if (!guid || !rowIds || rowIds.length === 0 || !createRow) {
      return;
    }

    let cancelled = false;
    const cleanups: Array<() => void> = [];

    void (async () => {
      let nextRowIndex = 0;
      const loadNextRows = async () => {
        while (!cancelled) {
          const rowIndex = nextRowIndex;

          nextRowIndex += 1;
          if (rowIndex >= rowIds.length) return;

          const rowId = rowIds[rowIndex];

          // If the row document already exists, skip creating it
          if (!rowDocsRef.current.has(rowId)) {
            try {
              const rowDoc = await createRow(getRowKey(guid, rowId));

              if (cancelled) return;

              rowDocsRef.current.set(rowId, rowDoc);
            } catch (e) {
              // Leave the doc missing, but still record the row below. Presence in `rowContents` is
              // what ends the row's loading placeholder, so bailing out here — or skipping the
              // write — would leave this row, and with a `continue` every row after it, pulsing
              // forever. An unreadable row falls back to the "Untitled" wording instead.
              // Deliberate: a failed row is retried only when `rowIds` or `guid` change (it stays
              // absent from `rowDocsRef`, so the next run re-attempts createRow) — not on
              // primary-field ticks, which no longer re-run this effect.
            }
          }

          if (cancelled) return;

          // Store the content in the ref
          recordContent(rowId);

          // A row doc can resolve before its primary cell has synced; without an observer the row
          // would stay on the "Untitled" fallback (and stay unmatchable by the search box) until
          // the picker is closed and reopened.
          const rowDoc = rowDocsRef.current.get(rowId);

          if (rowDoc) {
            cleanups.push(
              subscribeSharedYjsDeep(rowDoc.getMap(YjsEditorKey.data_section), () => recordContent(rowId))
            );
          }
        }
      };

      const workerCount = Math.min(ROW_LOAD_CONCURRENCY, rowIds.length);

      await Promise.all(Array.from({ length: workerCount }, loadNextRows));
    })();

    return () => {
      cancelled = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [createRow, guid, recordContent, rowIds]);

  // Membership sets, not `Array.includes`: both lists are scanned once per candidate row here and
  // again per rendered row, which is quadratic on a target database of any size.
  const relatedRowIdSet = useMemo(() => new Set(relationRowIds ?? []), [relationRowIds]);
  const liveRowIdSet = useMemo(() => new Set(rowIds), [rowIds]);

  // The recent-first ordering depends only on the row list, not the query, so keep it out of the
  // search memo — otherwise every keystroke re-sorts the whole target database. Recents recorded
  // while the picker is open take effect on the next open, same as before this split: picking a
  // row never changed this memo's inputs either.
  const sortedRowIds = useMemo(() => sortByRecentRows(rowIds, selectedViewId), [rowIds, selectedViewId]);

  const filteredRowIds = useMemo(() => {
    if (!searchInput) {
      return sortedRowIds;
    }

    const query = searchInput.toLowerCase();

    return sortedRowIds.filter((id) => (rowContents.get(id) || '').toLowerCase().includes(query));
  }, [rowContents, searchInput, sortedRowIds]);

  const unRelatedRowIds = useMemo(() => {
    return filteredRowIds.filter((id) => !relatedRowIdSet.has(id));
  }, [filteredRowIds, relatedRowIdSet]);

  const filteredRelatedRowIds = useMemo(() => {
    if (!relationRowIds) return [];

    const query = searchInput.toLowerCase();

    return relationRowIds.filter((id) => {
      const content = rowContents.get(id) || (liveRowIdSet.has(id) ? '' : t('document.mention.deletedPage'));

      return content.toLowerCase().includes(query);
    });
  }, [liveRowIdSet, relationRowIds, rowContents, searchInput, t]);

  // filteredRowIds covers live target rows (for adding); filteredRelatedRowIds
  // covers the cell's already-related ids (including stale/deleted ones).
  // Treating "no result" as both empty avoids hiding deleted relations the user
  // may want to remove.
  // `rowIdsLoaded` keeps an empty list from reading as "nothing matched" while it is really
  // "nothing has arrived yet".
  const isLoadingRows = loading || !rowIdsLoaded;
  const noResult = filteredRowIds.length === 0 && filteredRelatedRowIds.length === 0 && !isLoadingRows;

  const renderItem = useCallback(
    (id: string) => {
      const isRelated = relatedRowIdSet.has(id);
      const isDeleted = isRelated && !liveRowIdSet.has(id);
      // A row we know exists but whose primary cell has not landed yet. Deleted rows are excluded:
      // their wording is final, and their doc is never going to arrive.
      const isResolving = !isDeleted && !rowContents.has(id);
      const content = isDeleted ? t('document.mention.deletedPage') : rowContents.get(id) || '';

      return (
        <div
          onClick={() => {
            if (isRelated) {
              if (isDeleted) return;
              openRelatedRow(id);
              return;
            }

            rememberRecentRelationRow(selectedViewId, id);
            onAddRelationRowId(id);
          }}
          className={cn(
            dropdownMenuItemVariants({
              variant: 'default',
            }),
            'group flex items-center justify-between gap-2',
            selectedId === id && 'bg-fill-content-hover',
            'hover:bg-fill-content-hover'
          )}
          key={id}
          onMouseEnter={() => setSelectedId(id)}
        >
          <RelationRowItem rowId={id} content={content} loading={isResolving} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={(e) => {
                  e.stopPropagation();

                  if (isRelated) {
                    onRemoveRelationRowId(id);
                  } else {
                    rememberRecentRelationRow(selectedViewId, id);
                    onAddRelationRowId(id);
                  }
                }}
                variant={'ghost'}
                size={'icon'}
                className={cn(
                  'shrink-0 opacity-0 transition-opacity',
                  selectedId === id && 'opacity-100',
                  'group-hover:opacity-100'
                )}
              >
                {isRelated ? <MinusIcon /> : <PlusIcon />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isRelated ? t('grid.relation.removeRelation') : t('grid.relation.addRelation')}
            </TooltipContent>
          </Tooltip>
        </div>
      );
    },
    [
      relatedRowIdSet,
      liveRowIdSet,
      rowContents,
      selectedId,
      openRelatedRow,
      onAddRelationRowId,
      onRemoveRelationRowId,
      setSelectedId,
      selectedViewId,
      t,
    ]
  );

  const trimmedSearch = searchInput.trim();
  // Mirrors desktop's `_CreateAndLinkRowAction` (commit c811059939, AppFlowy#8644):
  // any non-empty query exposes the create affordance, even when the live
  // results already match. The user shouldn't have to clear partial matches
  // to create a new row that happens to share a substring.
  const showCreateAndLink = trimmedSearch.length > 0 && !isLoadingRows && !noAccess && primaryFieldId !== null;

  const handleCreateAndLink = useCallback(async () => {
    const targetDoc = targetDocRef.current;

    if (!targetDoc || !primaryFieldId || !trimmedSearch) return;
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;
    setIsCreatingAndLinking(true);
    try {
      const newRowId = await createRowInRelatedDatabase({
        relatedDatabaseDoc: targetDoc,
        primaryFieldId,
        primaryText: trimmedSearch,
        createRow,
        bindViewSync,
        actorUid,
      });

      if (!newRowId) return;

      // Clear the search so the freshly-created row is visible in the linked
      // section once the picker re-reads `relationRowIds`.
      setSearchInput('');
      // Locally append the new row id so the existing row-doc loader effect
      // picks it up and `rowContents` resolves the typed text for display.
      // Without this the picker captured `rowIds` once on open and would
      // render the new linked row as "Deleted page" until the dialog reopens.
      setRowIds((prev) => (prev.includes(newRowId) ? prev : [...prev, newRowId]));
      rememberRecentRelationRow(selectedViewId, newRowId);
      onAddRelationRowId(newRowId);
    } finally {
      isCreatingRef.current = false;
      setIsCreatingAndLinking(false);
    }
  }, [actorUid, bindViewSync, createRow, onAddRelationRowId, primaryFieldId, selectedViewId, trimmedSearch]);

  const renderCreateAndLink = useMemo(() => {
    if (!showCreateAndLink) return null;

    const databaseName = selectedView?.name ?? '';

    return (
      <button
        type='button'
        data-testid='relation-create-and-link'
        disabled={isCreatingAndLinking}
        onClick={() => {
          void handleCreateAndLink();
        }}
        className={cn(
          'flex w-full items-center gap-2 rounded-300 px-2 py-1.5 text-left text-sm',
          'text-text-primary hover:bg-fill-content-hover',
          'disabled:cursor-not-allowed disabled:opacity-60'
        )}
      >
        <AddIcon className='h-4 w-4 shrink-0 text-icon-primary' />
        <span className='min-w-0 flex-1 truncate'>
          {t('grid.relation.createAndLinkRow', {
            defaultValue: 'Create {{name}}',
            name: trimmedSearch,
          })}
        </span>
        {databaseName ? (
          <span className='min-w-0 max-w-[40%] shrink-0 truncate text-xs text-text-tertiary'>
            {t('grid.relation.createAndLinkRowDestination', {
              defaultValue: 'in {{target}}',
              target: databaseName,
            })}
          </span>
        ) : null}
      </button>
    );
  }, [handleCreateAndLink, isCreatingAndLinking, selectedView, showCreateAndLink, t, trimmedSearch]);

  const renderRelatedItems = useMemo(() => {
    if (!filteredRelatedRowIds || filteredRelatedRowIds.length === 0) {
      return null;
    }

    return (
      <div className={'flex flex-col text-sm'}>
        <DropdownMenuLabel>
          {t('grid.relation.linkedRowListLabel', {
            count: filteredRelatedRowIds.length,
          })}
        </DropdownMenuLabel>
        {filteredRelatedRowIds.map(renderItem)}
      </div>
    );
  }, [filteredRelatedRowIds, renderItem, t]);

  const renderUnrelatedItems = useMemo(() => {
    if (!unRelatedRowIds || unRelatedRowIds.length === 0) {
      return null;
    }

    return (
      <div className={'flex flex-col text-sm'}>
        <DropdownMenuLabel>{t('grid.relation.unlinkedRowListLabel')}</DropdownMenuLabel>
        {unRelatedRowIds.map(renderItem)}
      </div>
    );
  }, [unRelatedRowIds, renderItem, t]);

  return (
    <div
      ref={setElement}
      className={'appflowy-scroller flex max-h-[450px] w-[320px] flex-col overflow-y-auto'}
      onMouseDown={(e) => e.preventDefault()}
    >
      <TooltipProvider>
        <div className={'sticky top-0 z-[1] bg-surface-primary'}>
          <div className={'flex flex-col gap-2 p-2 pb-0 text-sm'}>
            <div className={'relative flex items-center text-text-secondary'}>
              <DropdownMenuLabel>
                {loading ? <Progress variant={'primary'} /> : t('grid.relation.inRelatedDatabase')}
              </DropdownMenuLabel>
              <span
                onClick={() => {
                  if (selectedView) {
                    void navigateToView?.(selectedView.view_id);
                  }
                }}
                className={'flex-1 cursor-pointer truncate text-text-primary underline'}
              >
                {selectedView?.name || t('menuAppHeader.defaultNewPageName')}
              </span>
            </div>
            <SearchInput
              autoFocus
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
              }}
              placeholder={t('searchLabel')}
            />
          </div>
          <Separator className={'mt-2'} />
        </div>
        <div className={'relative flex-1 p-2 pt-0'}>
          {isLoadingRows ? (
            <div
              aria-label={t('grid.row.loading', 'Loading rows')}
              className={'flex min-h-[160px] items-center justify-center'}
              role={'status'}
            >
              <Progress aria-hidden variant={'primary'} />
            </div>
          ) : noResult ? (
            <div className={'flex items-center py-2 text-sm text-text-secondary'}>{t('findAndReplace.noResult')}</div>
          ) : (
            !noAccess &&
            primaryFieldId && (
              <>
                {renderRelatedItems}
                {renderUnrelatedItems}
              </>
            )
          )}
          {renderCreateAndLink}
        </div>
      </TooltipProvider>
    </div>
  );
}

function RelationCellMenuContent(props: RelationCellMenuContentProps) {
  // All local docs, observers, and row state belong to one immutable target.
  // Remounting the implementation prevents a passive-effect frame from
  // combining database A's state with database B's identity.
  const targetKey = `${props.relatedDatabaseId}:${props.selectedView?.view_id ?? ''}`;

  return <RelationCellMenuContentForTarget key={targetKey} {...props} />;
}

export default RelationCellMenuContent;
