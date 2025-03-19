import { notify } from '@/components/_shared/notify';
import { Origins } from '@/components/_shared/popover';
import { useAppHandlers, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import DeletePageConfirm from '@/components/app/view-actions/DeletePageConfirm';
import MovePagePopover from '@/components/app/view-actions/MovePagePopover';
import { useService } from '@/components/main/app.hooks';
import { Button, CircularProgress } from '@mui/material';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as DeleteIcon } from '@/assets/trash.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/duplicate.svg';
import { ReactComponent as MoveToIcon } from '@/assets/move_to.svg';

function MoreActionsContent({ itemClicked, viewId, movePopoverOrigins, onDeleted }: {
  itemClicked?: () => void;
  onDeleted?: () => void;
  viewId: string;
  movePopoverOrigins: Origins
}) {
  const { t } = useTranslation();
  const [movePopoverAnchorEl, setMovePopoverAnchorEl] = useState<null | HTMLElement>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const service = useService();
  const workspaceId = useCurrentWorkspaceId();
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const {
    refreshOutline,
  } = useAppHandlers();
  const handleDuplicateClick = async() => {
    if(!workspaceId || !service) return;
    setDuplicateLoading(true);
    try {
      await service.duplicateAppPage(workspaceId, viewId);

      void refreshOutline?.();
      // eslint-disable-next-line
    } catch(e: any) {
      notify.error(e.message);
    } finally {
      setDuplicateLoading(false);
    }

    itemClicked?.();
  };

  return (
    <div className={'flex flex-col gap-2 more-actions'}>
      <Button
        size={'small'}
        className={'px-3 py-1 justify-start '}
        color={'inherit'}
        onClick={handleDuplicateClick}
        disabled={duplicateLoading}
        startIcon={duplicateLoading ? <CircularProgress size={14} /> : <DuplicateIcon />}
      >{t('button.duplicate')}</Button>
      <Button
        size={'small'}
        className={'px-3 py-1 justify-start '}
        color={'inherit'}
        onClick={(e) => {
          setMovePopoverAnchorEl(e.currentTarget);
        }}

        startIcon={<MoveToIcon />}
      >{t('disclosureAction.moveTo')}</Button>
      <Button
        size={'small'}
        className={'px-3 py-1 justify-start  hover:text-function-error'}
        color={'inherit'}
        onClick={() => {
          setDeleteModalOpen(true);
        }}

        startIcon={<DeleteIcon />}
      >{t('button.delete')}</Button>
      <DeletePageConfirm
        open={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          itemClicked?.();
        }}
        viewId={viewId}
        onDeleted={() => {
          onDeleted?.();
          itemClicked?.();
        }}
      />
      <MovePagePopover
        {...movePopoverOrigins}
        viewId={viewId}
        open={Boolean(movePopoverAnchorEl)}
        anchorEl={movePopoverAnchorEl}
        onClose={() => {
          setMovePopoverAnchorEl(null);
          itemClicked?.();
        }}
        onMoved={itemClicked}
      />
    </div>
  );
}

export default MoreActionsContent;