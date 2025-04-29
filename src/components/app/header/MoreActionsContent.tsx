import { ViewLayout } from '@/application/types';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as MoveToIcon } from '@/assets/icons/move_to.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { findView } from '@/components/_shared/outline/utils';
import { useAppOverlayContext } from '@/components/app/app-overlay/AppOverlayContext';
import { DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { useAppHandlers, useAppOutline, useAppView, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import MovePagePopover from '@/components/app/view-actions/MovePagePopover';
import { useService } from '@/components/main/app.hooks';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

function MoreActionsContent ({ itemClicked, viewId }: {
  itemClicked?: () => void;
  onDeleted?: () => void;
  viewId: string;
}) {
  const { t } = useTranslation();
  const {
    openDeleteModal,
  } = useAppOverlayContext();
  const service = useService();
  const workspaceId = useCurrentWorkspaceId();
  const view = useAppView(viewId);
  const layout = view?.layout;
  const outline = useAppOutline();
  const parentViewId = view?.parent_view_id;
  const parentLayout = useMemo(() => {
    if (!parentViewId) return null;
    if (!outline) return null;

    return findView(outline, parentViewId)?.layout;
  }, [outline, parentViewId]);

  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const {
    refreshOutline,
  } = useAppHandlers();
  const handleDuplicateClick = async () => {
    if (!workspaceId || !service) return;
    setDuplicateLoading(true);
    try {
      await service.duplicateAppPage(workspaceId, viewId);

      void refreshOutline?.();
      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDuplicateLoading(false);
    }

    itemClicked?.();
  };

  const [container, setContainer] = useState<HTMLElement | null>(null);

  return (
    <DropdownMenuGroup
    >
      <div
        ref={el => {

          setContainer(el);
        }}
      />
      <DropdownMenuItem
        className={`${layout === ViewLayout.AIChat ? 'hidden' : ''}`}
        onSelect={handleDuplicateClick}
        disabled={duplicateLoading}
      >
        {duplicateLoading ? <Progress /> : <DuplicateIcon />}
        {t('button.duplicate')}
      </DropdownMenuItem>
      {container && <MovePagePopover
        viewId={viewId}
        onMoved={itemClicked}
        popoverContentProps={{
          side: 'right',
          align: 'start',
          container,
        }}
      >
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
          }}
          disabled={parentLayout !== ViewLayout.Document}
        >
          <MoveToIcon />
          {t('disclosureAction.moveTo')}
        </DropdownMenuItem>
      </MovePagePopover>
      }

      <DropdownMenuItem
        className={'hover:text-text-error'}
        onSelect={() => {
          openDeleteModal(viewId);
        }}
      >
        <DeleteIcon />
        {t('button.delete')}
      </DropdownMenuItem>

    </DropdownMenuGroup>
  );
}

export default MoreActionsContent;