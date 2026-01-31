import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ViewLayout } from '@/application/types';
import { canBeMoved } from '@/application/view-utils';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as MoveToIcon } from '@/assets/icons/move_to.svg';
import { findView } from '@/components/_shared/outline/utils';
import { useAppOverlayContext } from '@/components/app/app-overlay/AppOverlayContext';
import { useAppHandlers, useAppOutline, useAppView, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import MovePagePopover from '@/components/app/view-actions/MovePagePopover';
import { useService } from '@/components/main/app.hooks';
import { DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu';


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
  const parentView = useMemo(() => {
    if (!parentViewId) return null;
    if (!outline) return null;

    return findView(outline, parentViewId) ?? null;
  }, [outline, parentViewId]);

  const {
    refreshOutline,
  } = useAppHandlers();
  const handleDuplicateClick = async () => {
    if (!workspaceId || !service) return;
    itemClicked?.();
    toast.loading(`${t('moreAction.duplicateView')}...`);
    try {
      await service.duplicateAppPage(workspaceId, viewId);
      toast.dismiss();
      void refreshOutline?.();
      // eslint-disable-next-line
    } catch (e: any) {
      toast.dismiss();
      toast.error(e.message);
    }
  };

  const [container, setContainer] = useState<HTMLElement | null>(null);
  const containerRef = useCallback((el: HTMLElement | null) => {
    setContainer(el);
  }, []);

  return (
    <DropdownMenuGroup
    >
      <div ref={containerRef} />
      <DropdownMenuItem
        className={`${layout === ViewLayout.AIChat ? 'hidden' : ''}`}
        onSelect={handleDuplicateClick}
      >
        <DuplicateIcon />
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
          disabled={!canBeMoved(view, parentView)}
        >
          <MoveToIcon />
          {t('disclosureAction.moveTo')}
        </DropdownMenuItem>
      </MovePagePopover>
      }

      <DropdownMenuItem
        data-testid="view-action-delete"
        variant={'destructive'}
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