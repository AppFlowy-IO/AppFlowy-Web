import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ViewLayout } from '@/application/types';
import { canBeMoved } from '@/application/view-utils';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/duplicate.svg';
import { ReactComponent as LockIcon } from '@/assets/icons/lock.svg';
import { ReactComponent as MoveToIcon } from '@/assets/icons/move_to.svg';
import { ReactComponent as SearchIcon } from '@/assets/icons/search.svg';
import { ReactComponent as TimeIcon } from '@/assets/icons/time.svg';
import { ViewService, PageService } from '@/application/services/domains';
import { findView } from '@/components/_shared/outline/utils';
import { useAppOverlayContext } from '@/components/app/app-overlay/AppOverlayContext';
import {
  useRefreshOutline,
  useAppOutline,
  useAppView,
  useCurrentWorkspaceId,
  useLoadViewChildren,
} from '@/components/app/app.hooks';
import { useSyncInternal } from '@/components/app/contexts/SyncInternalContext';
import MovePagePopover from '@/components/app/view-actions/MovePagePopover';
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';

const DUPLICATE_PRE_SYNC_TIMEOUT_MS = 8000;

function MoreActionsContent({
  itemClicked,
  viewId,
  onOpenHistory,
  onFindAndReplace,
}: {
  itemClicked?: () => void;
  onDeleted?: () => void;
  viewId: string;
  onOpenHistory?: () => void;
  onFindAndReplace?: () => void;
}) {
  const { t } = useTranslation();
  const { openDeleteModal, showBlockingLoader, hideBlockingLoader } = useAppOverlayContext();
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

  const refreshOutline = useRefreshOutline();
  const loadViewChildren = useLoadViewChildren();
  const { syncAllToServer } = useSyncInternal();
  const duplicateCopySuffix = useMemo(() => ` (${t('menuAppHeader.pageNameSuffix')})`, [t]);
  const handleDuplicateClick = useCallback(async () => {
    if (!workspaceId) return;
    itemClicked?.();
    // Show blocking loader to prevent user from interacting with the UI
    // (e.g., clicking on the duplicated page before it's fully created)
    showBlockingLoader(`${t('moreAction.duplicateView')}...`);
    try {
      // Sync all collab documents to the server via HTTP API before duplicating
      // This is similar to desktop's collab_full_sync_batch - ensures the server
      // has the latest data before the duplicate operation
      await Promise.race([
        syncAllToServer(workspaceId),
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, DUPLICATE_PRE_SYNC_TIMEOUT_MS);
        }),
      ]);
      await PageService.duplicate(workspaceId, viewId, {
        openAfterDuplicate: true,
        includeChildren: true,
        suffix: duplicateCopySuffix,
        source: 0,
      });
      void refreshOutline?.();
      // The shallow outline (depth=2) doesn't include children beyond space level.
      // Reload the parent view's children so the new duplicate appears in the sidebar.
      if (parentViewId) {
        ViewService.invalidateCache(workspaceId, parentViewId);
        void loadViewChildren?.(parentViewId);
      }

      itemClicked?.();
      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      hideBlockingLoader();
    }
  }, [
    workspaceId,
    viewId,
    refreshOutline,
    loadViewChildren,
    parentViewId,
    itemClicked,
    t,
    syncAllToServer,
    showBlockingLoader,
    hideBlockingLoader,
    duplicateCopySuffix,
  ]);

  const [container, setContainer] = useState<HTMLElement | null>(null);
  const containerRef = useCallback((el: HTMLElement | null) => {
    setContainer(el);
  }, []);

  const isDocument = layout === ViewLayout.Document;
  const isLocked = !!view?.is_locked;

  const handleToggleLock = useCallback(async () => {
    if (!workspaceId || !view) return;
    const next = !view.is_locked;

    try {
      await PageService.update(workspaceId, viewId, { name: view.name, is_locked: next });
      void refreshOutline?.();
      toast.success(next ? t('lockPage.pageLockedToast') : t('lockPage.pageUnlockedToast'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [workspaceId, view, viewId, refreshOutline, t]);

  return (
    <DropdownMenuGroup>
      <div ref={containerRef} />
      {isDocument && (
        <>
          <DropdownMenuItem
            data-testid={'more-page-lock'}
            onSelect={(event) => {
              event.preventDefault();
              void handleToggleLock();
            }}
          >
            <LockIcon />
            <span className={'flex-1'}>{t('disclosureAction.lockPage')}</span>
            <Switch checked={isLocked} tabIndex={-1} aria-hidden className={'pointer-events-none'} />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem
        data-testid={'more-page-duplicate'}
        className={`${layout === ViewLayout.AIChat ? 'hidden' : ''}`}
        onSelect={handleDuplicateClick}
      >
        <DuplicateIcon />
        {t('button.duplicate')}
      </DropdownMenuItem>
      {container && (
        <MovePagePopover
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
      )}

      {isDocument && onFindAndReplace && (
        <DropdownMenuItem
          data-testid={'more-page-find-and-replace'}
          onSelect={(event) => {
            event.preventDefault();
            onFindAndReplace();
          }}
        >
          <SearchIcon />
          {t('shareAction.findAndReplace')}
        </DropdownMenuItem>
      )}

      <DropdownMenuItem
        data-testid='view-action-delete'
        variant={'destructive'}
        onSelect={() => {
          openDeleteModal(viewId);
        }}
      >
        <DeleteIcon />
        {t('button.delete')}
      </DropdownMenuItem>

      {isDocument && onOpenHistory && (
        <DropdownMenuItem
          data-testid='more-page-version-history'
          onSelect={(event) => {
            event.preventDefault();
            onOpenHistory();
            itemClicked?.();
          }}
        >
          <TimeIcon />
          {t('versionHistory.versionHistory')}
        </DropdownMenuItem>
      )}
    </DropdownMenuGroup>
  );
}

export default MoreActionsContent;
