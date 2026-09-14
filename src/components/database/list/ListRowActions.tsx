import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabaseFields, useDatabaseView } from '@/application/database-yjs';
import type { Row } from '@/application/database-yjs';
import { useDuplicateRowDispatch, useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { getGroupRowCellsData } from '@/application/database-yjs/group-row';
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

export const getListGroupCellsData = getGroupRowCellsData;

/** The row-creation callbacks a gutter menu needs; how they are produced is the caller's business. */
export interface RowActionCallbacks {
  addAbove: () => Promise<unknown>;
  addBelow: () => Promise<unknown>;
  duplicate: () => Promise<unknown>;
}

/**
 * The hover `+` / `⋮⋮` gutter with its menu, loading and confirmation state.
 * Takes the row's callbacks as props so a view rendering many rows can create
 * the dispatch hooks once and hand each row a bound closure, instead of every
 * row subscribing to the database context on its own.
 */
export function RowActionsMenu({
  dragHandleRef,
  reorderable,
  rowId,
  addAbove,
  addBelow,
  duplicate,
}: RowActionCallbacks & {
  dragHandleRef?: (element: HTMLDivElement | null) => void;
  reorderable: boolean;
  rowId: string;
}) {
  const { t } = useTranslation();
  const [loadingAction, setLoadingAction] = useState<'above' | 'below' | 'duplicate' | null>(null);
  const run = useCallback(async (kind: 'above' | 'below' | 'duplicate', action: () => Promise<unknown>) => {
    setLoadingAction(kind);
    try {
      await action();
    } finally {
      setLoadingAction(null);
    }
  }, []);
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
        run: () => runAfterSortCheck(() => void run('above', addAbove)),
      },
      {
        testId: 'row-menu-insert-below',
        label: t('grid.row.insertRecordBelow'),
        icon: PlusIcon,
        loading: loadingAction === 'below',
        run: () => runAfterSortCheck(() => void run('below', addBelow)),
      },
      {
        testId: 'row-menu-duplicate',
        label: t('grid.row.duplicate'),
        icon: DuplicateIcon,
        loading: loadingAction === 'duplicate',
        run: () => void run('duplicate', duplicate),
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
    [addAbove, addBelow, duplicate, loadingAction, run, runAfterSortCheck, t]
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
            runAfterSortCheck(() => void run('below', addBelow));
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
                // Radix opens on pointer-down and cancels that event, which
                // keeps the browser from ever starting a native drag on the
                // same handle. Leave pointer-down alone and open on click.
                onPointerDownCapture={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen((open) => !open);
                }}
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

/** The List view's gutter: the same menu, with each row creating its own dispatches. */
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
  const fields = useDatabaseFields();
  const view = useDatabaseView();
  const createRow = useNewRowDispatch();
  const duplicateRow = useDuplicateRowDispatch();

  const addBelow = useCallback(
    () => createRow({ beforeRowId: rowId, cellsData: getListGroupCellsData(fields, groupFieldId, groupId, view) }),
    [createRow, fields, groupFieldId, groupId, rowId, view]
  );
  const addAbove = useCallback(() => {
    const rowIndex = rowOrders.findIndex((row) => row.id === rowId);
    const previousRowId = rowIndex > 0 ? rowOrders[rowIndex - 1]?.id : undefined;

    return createRow({
      beforeRowId: previousRowId,
      cellsData: getListGroupCellsData(fields, groupFieldId, groupId, view),
    });
  }, [createRow, fields, groupFieldId, groupId, rowId, rowOrders, view]);
  const duplicate = useCallback(() => duplicateRow(rowId), [duplicateRow, rowId]);

  return (
    <RowActionsMenu
      dragHandleRef={dragHandleRef}
      reorderable={reorderable}
      rowId={rowId}
      addAbove={addAbove}
      addBelow={addBelow}
      duplicate={duplicate}
    />
  );
}

export default ListRowActions;
