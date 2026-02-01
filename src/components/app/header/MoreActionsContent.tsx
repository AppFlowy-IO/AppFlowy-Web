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
import { useSyncInternal } from '@/components/app/contexts/SyncInternalContext';
import MovePagePopover from '@/components/app/view-actions/MovePagePopover';
import { useService } from '@/components/main/app.hooks';
import { DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu';


function MoreActionsContent({ itemClicked, viewId }: {
  itemClicked?: () => void;
  onDeleted?: () => void;
  viewId: string;
}) {
  const { t } = useTranslation();
  const {
    openDeleteModal,
    showBlockingLoader,
    hideBlockingLoader,
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
  const { syncAllToServer } = useSyncInternal();
  const handleDuplicateClick = useCallback(async () => {
    if (!workspaceId || !service) return;
    itemClicked?.();
    // Show blocking loader to prevent user from interacting with the UI
    // (e.g., clicking on the duplicated page before it's fully created)
    showBlockingLoader(`${t('moreAction.duplicateView')}...`);
    try {
      // Sync all collab documents to the server via HTTP API before duplicating
      // This is similar to desktop's collab_full_sync_batch - ensures the server
      // has the latest data before the duplicate operation
      await syncAllToServer(workspaceId);
      await service.duplicateAppPage(workspaceId, viewId);
      void refreshOutline?.();
      itemClicked?.();
      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      hideBlockingLoader();
    }
  }, [workspaceId, service, viewId, refreshOutline, itemClicked, t, syncAllToServer, showBlockingLoader, hideBlockingLoader]);

  const [container, setContainer] = useState<HTMLElement | null>(null);
  const containerRef = useCallback((el: HTMLElement | null) => {
    setContainer(el);
  }, []);

  return (
    <DropdownMenuGroup
    >
      <div ref={containerRef} />
      <DropdownMenuItem
        data-testid={'more-page-duplicate'}
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
          data-testid={'more-page-move-to'}
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