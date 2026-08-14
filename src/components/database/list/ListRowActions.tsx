import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabaseFields } from '@/application/database-yjs';
import type { Row } from '@/application/database-yjs';
import { useDuplicateRowDispatch, useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { getGroupCellData } from '@/application/database-yjs/group';
import { YjsDatabaseKey } from '@/application/types';
import type { FieldId, YDatabaseFields } from '@/application/types';
import { ReactComponent as UpIcon } from '@/assets/icons/arrow_up.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DragIcon } from '@/assets/icons/drag.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { DeleteRowConfirm } from '@/components/database/components/database-row/DeleteRowConfirm';
import { ClearSortingConfirm } from '@/components/database/components/sorts/ClearSortingConfirm';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';

import { useListHasSorts } from './ListSortState';

export function getListGroupCellsData(
  fields?: YDatabaseFields,
  groupFieldId?: string,
  groupId?: string
): Record<FieldId, string> | undefined {
  const groupField = groupFieldId ? fields?.get(groupFieldId) : undefined;

  if (groupFieldId && groupField && groupId === groupField.get(YjsDatabaseKey.id)) {
    return { [groupFieldId]: '' };
  }

  const groupCellData = groupField && groupId ? getGroupCellData(groupId, groupField) : undefined;

  return groupFieldId && groupCellData !== undefined ? { [groupFieldId]: groupCellData } : undefined;
}

function useListRowActions({
  groupFieldId,
  groupId,
  rowId,
  rowOrders,
}: {
  groupFieldId?: string;
  groupId?: string;
  rowId: string;
  rowOrders: Row[];
}) {
  const fields = useDatabaseFields();
  const createRow = useNewRowDispatch();
  const duplicateRow = useDuplicateRowDispatch();
  const [loadingAction, setLoadingAction] = useState<'above' | 'below' | 'duplicate' | null>(null);
  const cellsData = useMemo(() => getListGroupCellsData(fields, groupFieldId, groupId), [fields, groupFieldId, groupId]);

  const addBelow = useCallback(async () => {
    setLoadingAction('below');
    try {
      await createRow({ beforeRowId: rowId, cellsData });
    } finally {
      setLoadingAction(null);
    }
  }, [cellsData, createRow, rowId]);

  const addAbove = useCallback(async () => {
    const rowIndex = rowOrders.findIndex((row) => row.id === rowId);
    const previousRowId = rowIndex > 0 ? rowOrders[rowIndex - 1]?.id : undefined;

    setLoadingAction('above');
    try {
      await createRow({ beforeRowId: previousRowId, cellsData });
    } finally {
      setLoadingAction(null);
    }
  }, [cellsData, createRow, rowId, rowOrders]);

  const duplicate = useCallback(async () => {
    setLoadingAction('duplicate');
    try {
      await duplicateRow(rowId);
    } finally {
      setLoadingAction(null);
    }
  }, [duplicateRow, rowId]);

  return { addAbove, addBelow, duplicate, loadingAction };
}

export function ListRowActions({
  dragHandleRef,
  groupFieldId,
  groupId,
  reorderable,
  rowId,
  rowOrders,
}: {
  dragHandleRef?: (element: HTMLDivElement | null) => void;
  groupFieldId?: string;
  groupId?: string;
  reorderable: boolean;
  rowId: string;
  rowOrders: Row[];
}) {
  const { t } = useTranslation();
  const { addAbove, addBelow, duplicate, loadingAction } = useListRowActions({
    groupFieldId,
    groupId,
    rowId,
    rowOrders,
  });
  const hasSorts = useListHasSorts();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [clearSortsOpen, setClearSortsOpen] = useState(false);
  const continueAfterClearRef = useRef<(() => void) | null>(null);

  const runAfterSortCheck = useCallback(
    (action: () => void) => {
      if (!hasSorts) {
        action();
        return;
      }

      continueAfterClearRef.current = action;
      setClearSortsOpen(true);
    },
    [hasSorts]
  );

  const actions = useMemo(
    () => [
      {
        testId: 'row-menu-insert-above',
        label: t('grid.row.insertRecordAbove'),
        icon: UpIcon,
        loading: loadingAction === 'above',
        run: () => runAfterSortCheck(() => void addAbove()),
      },
      {
        testId: 'row-menu-insert-below',
        label: t('grid.row.insertRecordBelow'),
        icon: PlusIcon,
        loading: loadingAction === 'below',
        run: () => runAfterSortCheck(() => void addBelow()),
      },
      {
        testId: 'row-menu-duplicate',
        label: t('grid.row.duplicate'),
        icon: DuplicateIcon,
        loading: loadingAction === 'duplicate',
        run: () => void duplicate(),
      },
      {
        testId: 'row-menu-delete',
        label: t('grid.row.delete'),
        icon: DeleteIcon,
        loading: false,
        run: () => setDeleteOpen(true),
        destructive: true,
      },
    ],
    [addAbove, addBelow, duplicate, loadingAction, runAfterSortCheck, t]
  );

  return (
    <>
      <div
        className='pointer-events-none flex h-9 w-10 shrink-0 items-center justify-end opacity-0 group-focus-within/list-row:pointer-events-auto group-focus-within/list-row:opacity-100 group-hover/list-row:pointer-events-auto group-hover/list-row:opacity-100'
        data-testid={`list-row-actions-${rowId}`}
      >
        <Button
          aria-label={t('tooltip.addNewRow')}
          className='h-[30px] w-5 rounded-[4px] p-[3px] text-icon-secondary'
          data-testid={`list-row-add-below-${rowId}`}
          loading={loadingAction === 'above' || loadingAction === 'below'}
          onClick={(event) => {
            event.stopPropagation();
            runAfterSortCheck(() => void addBelow());
          }}
          size='icon-sm'
          tabIndex={-1}
          title={t('tooltip.addNewRow')}
          type='button'
          variant='ghost'
        >
          {loadingAction === 'above' || loadingAction === 'below' ? (
            <Progress variant='primary' />
          ) : (
            <PlusIcon aria-hidden='true' className='h-3.5 w-3.5' />
          )}
        </Button>

        <div className='flex h-[30px] w-5 shrink-0' ref={dragHandleRef}>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={reorderable ? `${t('tooltip.dragRow')}. ${t('tooltip.openMenu')}` : t('tooltip.openMenu')}
                className='h-[30px] w-5 rounded-[4px] p-[3px] text-icon-secondary focus-visible:ring-1 focus-visible:ring-fill-theme-thick'
                data-testid='row-accessory-button'
                onClick={(event) => event.stopPropagation()}
                size='icon-sm'
                title={reorderable ? `${t('tooltip.dragRow')} · ${t('tooltip.openMenu')}` : t('tooltip.openMenu')}
                type='button'
                variant='ghost'
              >
                <DragIcon aria-hidden='true' className='h-3.5 w-3.5' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className='w-[200px] min-w-[200px]'
              data-testid='list-row-action-menu'
              onCloseAutoFocus={(event) => event.preventDefault()}
              side='right'
              sideOffset={6}
            >
              <DropdownMenuGroup className='flex flex-col gap-2' data-testid='list-row-action-menu-items'>
                {actions.map((action) => (
                  <DropdownMenuItem
                    data-testid={action.testId}
                    key={action.testId}
                    onSelect={(event) => {
                      event.preventDefault();
                      action.run();
                      setMenuOpen(false);
                    }}
                    variant={action.destructive ? 'destructive' : 'default'}
                  >
                    {action.loading ? <Progress variant='primary' /> : <action.icon aria-hidden='true' />}
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {clearSortsOpen ? (
        <ClearSortingConfirm
          onClose={() => {
            continueAfterClearRef.current = null;
            setClearSortsOpen(false);
          }}
          onRemoved={() => {
            continueAfterClearRef.current?.();
            continueAfterClearRef.current = null;
          }}
          open
        />
      ) : null}
      {deleteOpen ? <DeleteRowConfirm onClose={() => setDeleteOpen(false)} open rowIds={[rowId]} /> : null}
    </>
  );
}

export default ListRowActions;
