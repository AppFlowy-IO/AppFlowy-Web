import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getPrimaryFieldId, useDatabaseContext } from '@/application/database-yjs';
import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { createRowInRelatedDatabase } from '@/application/database-yjs/dispatch/relation';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { View, YDatabase, YDatabaseField, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { ReactComponent as AddIcon } from '@/assets/icons/add_new_page.svg';
import { ReactComponent as MinusIcon } from '@/assets/icons/minus.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import RelationRowItem from '@/components/database/components/cell/relation/RelationRowItem';
import { useNavigationKey } from '@/components/database/components/cell/relation/useNavigationKey';
import { Button } from '@/components/ui/button';
import { dropdownMenuItemVariants, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { SearchInput } from '@/components/ui/search-input';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const recentRelationRowsByView = new Map<string, string[]>();

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

function RelationCellMenuContent({
  relationRowIds,
  selectedView,
  onAddRelationRowId,
  onRemoveRelationRowId,
  loading,
  onClose,
}: {
  loading?: boolean;
  relationRowIds?: string[];
  selectedView?: View;
  onAddRelationRowId: (rowId: string) => void;
  onRemoveRelationRowId: (rowId: string) => void;
  relatedDatabaseId: string;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const { navigateToView, loadView, navigateToRow, createRow, bindViewSync } = useDatabaseContext();
  const [element, setElement] = useState<HTMLElement | null>(null);
  const selectedViewId = useMemo(() => {
    return selectedView?.view_id;
  }, [selectedView]);
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
  const [guid, setGuid] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [rowIds, setRowIds] = useState<string[]>([]);
  const [rowContents, setRowContents] = useState<Map<string, string>>(new Map());
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
    void (async () => {
      if (!loadView) {
        return;
      }

      if (!selectedViewId) {
        return;
      }

      try {
        const doc = await loadView(selectedViewId);

        targetDocRef.current = doc;
        const guid = doc.guid;

        setGuid(guid);
        const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
        const fieldId = getPrimaryFieldId(database);

        if (!fieldId) {
          setNoAccess(true);
          return;
        }

        setNoAccess(false);
        setPrimaryFieldId(fieldId);
        setPrimaryField(database.get(YjsDatabaseKey.fields)?.get(fieldId) || null);

        const views = database.get(YjsDatabaseKey.views);
        const view = views.get(selectedViewId);
        const rows = view.get(YjsDatabaseKey.row_orders);
        const ids = rows.toArray().map((row) => row.id);

        setRowIds(ids);
      } catch (e) {
        //
      }
    })();
  }, [loadView, selectedViewId]);

  const getContent = useCallback(
    (rowId: string) => {
      const rowDoc = rowDocsRef.current.get(rowId);

      if (!rowDoc || !primaryFieldId) {
        return '';
      }

      const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
      const row = rowSharedRoot?.get(YjsEditorKey.database_row) as YDatabaseRow;
      const cell = row?.get(YjsDatabaseKey.cells)?.get(primaryFieldId);

      if (!cell) return '';
      const cellValue = parseYDatabaseCellToCell(cell, primaryField || undefined);

      return (cellValue?.data as string) || '';
    },
    [primaryFieldId, primaryField]
  );

  useEffect(() => {
    if (!guid || !rowIds || rowIds.length === 0 || !createRow) {
      return;
    }

    void (async () => {
      for (const rowId of rowIds) {
        if (rowDocsRef.current.has(rowId)) {
          // If the row document already exists, skip creating it
          setRowContents((prev) => {
            const newContents = new Map(prev);

            newContents.set(rowId, getContent(rowId));
            return newContents;
          });
          continue;
        }

        const rowKey = getRowKey(guid, rowId);
        const rowDoc = await createRow(rowKey);

        rowDocsRef.current.set(rowId, rowDoc);

        // Store the content in the ref
        setRowContents((prev) => {
          const newContents = new Map(prev);

          newContents.set(rowId, getContent(rowId));
          return newContents;
        });
      }
    })();
  }, [createRow, getContent, guid, rowIds]);

  const filteredRowIds = useMemo(() => {
    const liveRowIds = sortByRecentRows(rowIds, selectedViewId);

    if (!searchInput) {
      return liveRowIds;
    }

    return liveRowIds.filter((id) => {
      const content = rowContents.get(id) || '';

      return content.toLowerCase().includes(searchInput.toLowerCase());
    });
  }, [rowContents, rowIds, searchInput, selectedViewId]);

  const unRelatedRowIds = useMemo(() => {
    return filteredRowIds.filter((id) => !relationRowIds?.includes(id));
  }, [filteredRowIds, relationRowIds]);

  const filteredRelatedRowIds = useMemo(() => {
    return (
      relationRowIds?.filter((id) => {
        const content = rowContents.get(id) || (rowIds.includes(id) ? '' : t('document.mention.deletedPage'));

        return content.toLowerCase().includes(searchInput.toLowerCase());
      }) || []
    );
  }, [relationRowIds, rowContents, rowIds, searchInput, t]);

  // filteredRowIds covers live target rows (for adding); filteredRelatedRowIds
  // covers the cell's already-related ids (including stale/deleted ones).
  // Treating "no result" as both empty avoids hiding deleted relations the user
  // may want to remove.
  const noResult = filteredRowIds.length === 0 && filteredRelatedRowIds.length === 0 && !loading;

  const renderItem = useCallback(
    (id: string) => {
      const isRelated = relationRowIds?.includes(id);
      const isDeleted = isRelated && !rowIds.includes(id);
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
          <RelationRowItem rowId={id} content={content} />
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
                  (selectedId === id) && 'opacity-100',
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
      relationRowIds,
      rowContents,
      rowIds,
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
  const showCreateAndLink = trimmedSearch.length > 0 && !loading && !noAccess && primaryFieldId !== null;

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
  }, [bindViewSync, createRow, onAddRelationRowId, primaryFieldId, selectedViewId, trimmedSearch]);

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
          {noResult ? (
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

export default RelationCellMenuContent;
