import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getPrimaryFieldId, useDatabaseContext } from '@/application/database-yjs';
import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { View, YDatabase, YDatabaseField, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
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
  const { navigateToView, loadView, navigateToRow, createRow } = useDatabaseContext();
  const [element, setElement] = useState<HTMLElement | null>(null);
  const onToggleSelectedRowId = useCallback(
    (rowId: string) => {
      if (relationRowIds?.includes(rowId)) {
        onRemoveRelationRowId(rowId);
      } else {
        onAddRelationRowId(rowId);
      }
    },
    [onAddRelationRowId, onRemoveRelationRowId, relationRowIds]
  );
  const selectedViewId = useMemo(() => {
    return selectedView?.view_id;
  }, [selectedView]);

  const [searchInput, setSearchInput] = useState<string>('');
  const [primaryFieldId, setPrimaryFieldId] = useState<string | null>(null);
  const [primaryField, setPrimaryField] = useState<YDatabaseField | null>(null);
  const [guid, setGuid] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [rowIds, setRowIds] = useState<string[]>([]);
  const [rowContents, setRowContents] = useState<Map<string, string>>(new Map());
  const rowDocsRef = useRef<Map<string, YDoc>>(new Map());

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
    if (!searchInput) {
      return rowIds;
    }

    return rowIds.filter((id) => {
      const content = rowContents.get(id) || '';

      return content.toLowerCase().includes(searchInput.toLowerCase());
    });
  }, [rowContents, rowIds, searchInput]);

  const unRelatedRowIds = useMemo(() => {
    return filteredRowIds.filter((id) => !relationRowIds?.includes(id));
  }, [filteredRowIds, relationRowIds]);

  const filteredRelatedRowIds = useMemo(() => {
    return (
      relationRowIds?.filter((id) => {
        const content = rowContents.get(id) || '';

        return content.toLowerCase().includes(searchInput.toLowerCase());
      }) || []
    );
  }, [relationRowIds, rowContents, searchInput]);

  const noResult = filteredRowIds.length === 0 && !loading;

  const renderItem = useCallback(
    (id: string) => {
      const isRelated = relationRowIds?.includes(id);

      return (
        <div
          onClick={() => {
            // Close the popover first, then navigate after state settles
            onClose?.();
            setTimeout(() => {
              void navigateToRow?.(id, selectedViewId);
            }, 0);
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
          <RelationRowItem rowId={id} content={rowContents.get(id) || ''} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={(e) => {
                  e.stopPropagation();

                  if (isRelated) {
                    onRemoveRelationRowId(id);
                  } else {
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
      selectedId,
      navigateToRow,
      selectedViewId,
      onAddRelationRowId,
      onRemoveRelationRowId,
      onClose,
      setSelectedId,
      t,
    ]
  );

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
        </div>
      </TooltipProvider>
    </div>
  );
}

export default RelationCellMenuContent;
