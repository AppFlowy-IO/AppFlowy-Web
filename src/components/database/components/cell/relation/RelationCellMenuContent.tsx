import { getPrimaryFieldId, useDatabaseContext } from '@/application/database-yjs';
import { View, YDatabase, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import RelationRowItem from '@/components/database/components/cell/relation/RelationRowItem';
import { useNavigationKey } from '@/components/database/components/cell/relation/useNavigationKey';
import { Button } from '@/components/ui/button';
import { dropdownMenuItemVariants, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { SearchInput } from '@/components/ui/search-input';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as MinusIcon } from '@/assets/icons/minus.svg';

function RelationCellMenuContent ({
  relationRowIds,
  selectedView,
  onAddRelationRowId,
  onRemoveRelationRowId,
  loading,
}: {
  loading?: boolean;
  relationRowIds?: string[];
  selectedView?: View;
  onAddRelationRowId: (rowId: string) => void;
  onRemoveRelationRowId: (rowId: string) => void;
  relatedDatabaseId: string;
}) {
  const { t } = useTranslation();
  const { navigateToView, loadView, navigateToRow } = useDatabaseContext();
  const [element, setElement] = useState<HTMLElement | null>(null);
  const onToggleSelectedRowId = useCallback((rowId: string) => {
    if (relationRowIds?.includes(rowId)) {
      onRemoveRelationRowId(rowId);
    } else {
      onAddRelationRowId(rowId);
    }
  }, [onAddRelationRowId, onRemoveRelationRowId, relationRowIds]);
  const selectedViewId = useMemo(() => {
    return selectedView?.view_id;
  }, [selectedView]);

  const [searchInput, setSearchInput] = useState<string>('');
  const [primaryFieldId, setPrimaryFieldId] = useState<string | null>(null);
  const [guid, setGuid] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [rowIds, setRowIds] = useState<string[]>([]);

  const {
    selectedId,
    setSelectedId,
  } = useNavigationKey({
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

        const views = database.get(YjsDatabaseKey.views);
        const view = views.get(selectedViewId);
        const rows = view.get(YjsDatabaseKey.row_orders);
        const ids = rows.toArray().map(row => row.id);

        setRowIds(ids);
      } catch (e) {
        //
      }

    })();
  }, [loadView, selectedViewId]);

  const unRelatedRowIds = useMemo(() => {
    return rowIds.filter(id => !relationRowIds?.includes(id));
  }, [rowIds, relationRowIds]);

  return (
    <div
      ref={setElement}
      className={'flex flex-col max-h-[450px] w-[320px] appflowy-scroller overflow-y-auto'}
      onMouseDown={e => e.preventDefault()}
    >
      <div className={'sticky top-0 z-[1] bg-surface-primary'}>
        <div className={'p-2 pb-0 text-sm flex flex-col gap-2'}>
          <div className={'flex relative items-center text-text-secondary'}>
            <DropdownMenuLabel>
              {loading ? <Progress
                variant={'primary'}
              /> : t('grid.relation.inRelatedDatabase')}
            </DropdownMenuLabel>
            <span
              onClick={() => {
                if (selectedView) {
                  void navigateToView?.(selectedView.view_id);
                }
              }}
              className={'underline truncate flex-1 text-text-primary cursor-pointer'}
            >
            {selectedView?.name || t('menuAppHeader.defaultNewPageName')}

          </span>
          </div>
          <SearchInput
            autoFocus
            value={searchInput}
            onChange={e => {
              setSearchInput(e.target.value);
            }}
            placeholder={t('searchLabel')}
          />
        </div>
        <Separator className={'mt-2'} />
      </div>
      <div className={'relative flex-1 p-2 pt-0'}>
        {
          !noAccess && primaryFieldId && (<>
            {relationRowIds && relationRowIds.length > 0 && (<div className={'text-sm flex flex-col'}>
              <DropdownMenuLabel>
                {t('grid.relation.linkedRowListLabel', {
                  count: relationRowIds.length,
                })}
              </DropdownMenuLabel>
              {relationRowIds.map(id => (
                <div
                  onClick={() => {
                    void navigateToRow?.(id);
                  }}
                  className={cn(dropdownMenuItemVariants({
                    variant: 'default',
                  }), selectedId === id && 'bg-fill-content-hover', 'hover:bg-fill-content-hover')}
                  key={id}
                  onMouseEnter={() => setSelectedId(id)}
                >
                  <RelationRowItem
                    rowId={id}
                    rowKey={`${guid}_rows_${id}`}
                    primaryFieldId={primaryFieldId}
                  />
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveRelationRowId(id);
                    }}
                    variant={'ghost'}
                    size={'icon'}
                    className={selectedId === id ? 'visible' : 'invisible'}
                  >
                    <MinusIcon />
                  </Button>

                </div>
              ))}
            </div>)}
            {unRelatedRowIds && unRelatedRowIds.length > 0 && <div className={'text-sm flex flex-col'}>
              <DropdownMenuLabel>
                {t('grid.relation.unlinkedRowListLabel')}
              </DropdownMenuLabel>
              {unRelatedRowIds.map(id => (
                <div
                  onClick={() => {
                    onAddRelationRowId(id);
                  }}
                  className={cn(dropdownMenuItemVariants({
                    variant: 'default',
                  }), selectedId === id && 'bg-fill-content-hover', 'hover:bg-fill-content-hover')}
                  key={id}
                  onMouseEnter={() => setSelectedId(id)}
                >
                  <RelationRowItem
                    rowId={id}
                    rowKey={`${guid}_rows_${id}`}
                    primaryFieldId={primaryFieldId}
                  />
                </div>
              ))}
            </div>}
          </>)
        }
      </div>
    </div>
  );
}

export default RelationCellMenuContent;