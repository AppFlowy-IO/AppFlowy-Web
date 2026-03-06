import { Button, IconButton, TableContainer, Tooltip } from '@mui/material';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import dayjs from 'dayjs';
import React, { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { View } from '@/application/types';
import { ReactComponent as TrashIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as RestoreIcon } from '@/assets/icons/restore.svg';
import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import TableSkeleton from '@/components/_shared/skeleton/TableSkeleton';
import { useAppOperations, useAppTrash, useCurrentWorkspaceId } from '@/components/app/app.hooks';

function TrashPage() {
  const { t } = useTranslation();

  const currentWorkspaceId = useCurrentWorkspaceId();
  const { trashList, loadTrash } = useAppTrash();
  const [deleteViewId, setDeleteViewId] = React.useState<string | undefined>(undefined);
  const deleteView = useMemo(() => {
    return trashList?.find((view) => view.view_id === deleteViewId);
  }, [deleteViewId, trashList]);
  const { deleteTrash, restorePage } = useAppOperations();

  const handleRestore = useCallback(
    async (viewId?: string) => {
      if (!currentWorkspaceId) return;
      try {
        await restorePage?.(viewId);
        void loadTrash?.(currentWorkspaceId);
        // eslint-disable-next-line
      } catch (e: any) {
        notify.error(`Failed to restore page: ${e.message}`);
      }
    },
    [restorePage, loadTrash, currentWorkspaceId]
  );

  const handleDelete = useCallback(
    async (viewId?: string) => {
      if (!currentWorkspaceId) return;
      try {
        await deleteTrash?.(viewId);
        setDeleteViewId(undefined);
        void loadTrash?.(currentWorkspaceId);
        // eslint-disable-next-line
      } catch (e: any) {
        notify.error(`Failed to delete page: ${e.message}`);
      }
    },
    [deleteTrash, loadTrash, currentWorkspaceId]
  );

  useEffect(() => {
    void (async () => {
      if (!currentWorkspaceId) return;
      try {
        await loadTrash?.(currentWorkspaceId);
      } catch (e) {
        notify.error('Failed to load trash');
      }
    })();
  }, [loadTrash, currentWorkspaceId]);

  const columns = useMemo(() => {
    return [
      { id: 'name', label: t('trash.pageHeader.fileName'), minWidth: 170 },
      { id: 'last_edited_time', label: t('trash.pageHeader.lastModified'), minWidth: 170 },
      { id: 'created_at', label: t('trash.pageHeader.created'), minWidth: 170 },
      { id: 'actions', label: '', minWidth: 170 },
    ];
  }, [t]);

  const renderCell = useCallback(
    (column: (typeof columns)[0], row: View) => {
      // eslint-disable-next-line
      // @ts-ignore
      const value = row[column.id];
      let content = null;

      if (column.id === 'actions') {
        content = (
          <div className={'flex gap-2'}>
            <Tooltip title={t('trash.restore')}>
              <IconButton
                data-testid="trash-restore-button"
                size={'small'}
                onClick={() => {
                  void handleRestore(row.view_id);
                }}
              >
                <RestoreIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('button.delete')}>
              <IconButton
                data-testid="trash-delete-button"
                size={'small'}
                onClick={() => {
                  setDeleteViewId(row.view_id);
                }}
                className={'hover:text-function-error'}
              >
                <TrashIcon />
              </IconButton>
            </Tooltip>
          </div>
        );
      } else if (column.id === 'created_at' || column.id === 'last_edited_time') {
        content = <div className={'min-w-[170px] truncate'}>{dayjs(value).format('MMM D, YYYY h:mm A')}</div>;
      } else {
        content = (
          <div className={'max-w-[250px] flex-1 truncate'}>
            <Tooltip title={value}>
              <span>{value || t('menuAppHeader.defaultNewPageName')}</span>
            </Tooltip>
          </div>
        );
      }

      return (
        <TableCell key={column.id} align={'left'} className={'overflow-hidden font-medium'}>
          {content}
        </TableCell>
      );
    },
    [handleRestore, t]
  );

  return (
    <div
      style={{
        height: 'calc(100vh - 48px)',
      }}
      className={'flex h-full w-full flex-1 flex-col items-center'}
    >
      <div className={'flex h-full w-[964px] min-w-0 max-w-full flex-col gap-4 px-6 py-10'}>
        <div className={'flex items-center justify-between px-4'}>
          <span className={'text-xl font-medium text-text-primary'}>{t('trash.text')}</span>
          {trashList?.length ? (
            <div className={'flex gap-2'}>
              <Button size={'small'} onClick={() => handleRestore()} startIcon={<RestoreIcon />} color={'inherit'}>
                {t('trash.restoreAll')}
              </Button>
              <Button
                size={'small'}
                className={'hover:text-function-error'}
                onClick={() => setDeleteViewId('all')}
                startIcon={<TrashIcon />}
                color={'inherit'}
              >
                {t('trash.deleteAll')}
              </Button>
            </div>
          ) : null}
        </div>
        <div className={'flex w-full flex-1 flex-col gap-2 overflow-hidden'}>
          {!trashList ? (
            <TableSkeleton rows={8} columns={4} />
          ) : (
            <TableContainer data-testid="trash-table" className={'appflowy-scroller'} sx={{ maxHeight: '100%' }}>
              <Table stickyHeader aria-label='sticky table'>
                <TableHead>
                  <TableRow>
                    {columns.map((column) => (
                      <TableCell
                        className={'font-medium text-text-secondary'}
                        key={column.id}
                        align={'left'}
                        style={{ minWidth: column.minWidth }}
                      >
                        {column.label}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {trashList.map((row) => {
                    return (
                      <TableRow
                        data-testid="trash-table-row"
                        hover
                        role='checkbox'
                        tabIndex={-1}
                        key={row.view_id}
                        className={'max-h-[54px] overflow-hidden'}
                      >
                        {columns.map((column) => {
                          return renderCell(column, row);
                        })}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </div>
      </div>

      <NormalModal
        keepMounted={false}
        okText={t('button.delete')}
        cancelText={t('button.cancel')}
        open={deleteViewId !== undefined}
        danger={true}
        onClose={() => setDeleteViewId(undefined)}
        title={
          <div className={'flex w-full items-center text-left font-semibold'}>{`${t('button.delete')}: ${
            deleteView?.name || t('menuAppHeader.defaultNewPageName')
          }`}</div>
        }
        onOk={() => {
          void handleDelete(deleteViewId === 'all' ? undefined : deleteViewId);
        }}
        PaperProps={{
          className: 'w-[420px] max-w-[70vw]',
        }}
      >
        <div className={'font-normal text-text-secondary'}>
          {deleteViewId === 'all' ? t('trash.confirmDeleteAll.caption') : t('trash.confirmDeleteTitle')}
        </div>
      </NormalModal>
    </div>
  );
}

export default TrashPage;
