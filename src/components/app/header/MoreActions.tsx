import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { APP_EVENTS } from '@/application/constants';
import { AIService } from '@/application/services/domains';
import { getDatabaseIdFromWorkspaceCatalog } from '@/application/services/domains/view';
import { Types, ViewLayout, type View } from '@/application/types';
import { getDatabaseIdFromExtra, isDatabaseLayout } from '@/application/view-utils';
import { ReactComponent as AddToPageIcon } from '@/assets/icons/add_to_page.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as TimeIcon } from '@/assets/icons/time.svg';
import { useAIChatContext } from '@/components/ai-chat/AIChatProvider';
import {
  useAIEnabled,
  useDatabaseHistoryEnabled,
  useAppView,
  useCurrentWorkspaceId,
  useEventEmitter,
  usePageHistoryEnabled,
} from '@/components/app/app.hooks';
import { useSyncInternalOptional } from '@/components/app/contexts/SyncInternalContext';
import DocumentInfo from '@/components/app/header/DocumentInfo';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import MoreActionsContent from './MoreActionsContent';

const DocumentHistoryModal = lazy(() => import('@/components/document/history/DocumentHistoryModal'));
const DatabaseHistoryModal = lazy(() => import('@/components/database/history/DatabaseHistoryModal'));

function DatabaseHistoryMenuItem({ databaseId, viewId, view, onOpenHistory }: {
  databaseId: string; viewId: string; view?: View; onOpenHistory: () => void;
}) {
  const { t } = useTranslation();
  const { canWrite } = useViewActionPermissions(view, true, viewId, {
    collabObjectId: databaseId, collabType: Types.Database,
  });

  return canWrite ? <DropdownMenuItem data-testid='more-page-database-history' onSelect={onOpenHistory}>
    <TimeIcon />{t('versionHistory.versionHistory')}
  </DropdownMenuItem> : null;
}

function PermissionedMoreActionsContent({
  chatOptions,
  databaseId,
  activeViewId,
  activeView,
  handleClose,
  isDocument,
  onDeleted,
  onFindAndReplace,
  onOpenHistory,
  showHistory,
  view,
  viewId,
}: {
  chatOptions: ReactNode;
  databaseId?: string;
  activeViewId?: string;
  activeView?: View;
  handleClose: () => void;
  isDocument: boolean;
  onDeleted?: () => void;
  onFindAndReplace: () => void;
  onOpenHistory: () => void;
  showHistory: boolean;
  view: ReturnType<typeof useAppView>;
  viewId: string;
}) {
  const {
    canCreateViewActions,
    canManageViewActions,
    canUsePageHistory,
    hasLoadedViewActionPermissions,
    isLoadingViewActionPermissions,
  } = useViewActionPermissions(view, true, viewId);
  const isResolvingViewActionPermissions = isLoadingViewActionPermissions || !hasLoadedViewActionPermissions;

  return (
    <>
      <DropdownMenuGroup>{chatOptions}</DropdownMenuGroup>

      <MoreActionsContent
        itemClicked={handleClose}
        onDeleted={onDeleted}
        viewId={viewId}
        canDuplicateActions={canCreateViewActions}
        canEditActions={canCreateViewActions}
        canManageActions={canManageViewActions}
        canUsePageHistory={canUsePageHistory}
        isLoadingActions={isResolvingViewActionPermissions}
        onOpenHistory={showHistory ? onOpenHistory : undefined}
        onFindAndReplace={isDocument ? onFindAndReplace : undefined}
      />
      {showHistory && databaseId && (
        <DatabaseHistoryMenuItem databaseId={databaseId} viewId={activeViewId || viewId} view={activeView} onOpenHistory={onOpenHistory} />
      )}
      <DropdownMenuSeparator />

      <DocumentInfo viewId={viewId} />
    </>
  );
}

function MoreActions({
  viewId,
  activeViewId = viewId,
  viewMetadata,
  rowId,
  onDeleted,
  menuContentProps,
}: {
  viewId: string;
  /** The layout tab mounted by this page; modal callers default to their own view. */
  activeViewId?: string;
  /** Metadata fetched by a page modal before its outline branch is loaded. */
  viewMetadata?: View | null;
  rowId?: string | null;
  onDeleted?: () => void;
  menuContentProps?: ComponentProps<typeof DropdownMenuContent>;
} & ComponentProps<typeof DropdownMenu>) {
  const workspaceId = useCurrentWorkspaceId();
  const databaseHistoryEnabled = useDatabaseHistoryEnabled();
  const activeOutlineView = useAppView(activeViewId);
  const user = useCurrentUserOptional();
  const sync = useSyncInternalOptional();
  const reloadDatabaseAfterRestore = sync?.reloadDatabaseAfterRestore;
  const [databaseId, setDatabaseId] = useState<string>();
  const aiEnabled = useAIEnabled();
  const { selectionMode, onOpenSelectionMode } = useAIChatContext();
  const [hasMessages, setHasMessages] = useState(false);
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const outlineView = useAppView(viewId);
  const view = outlineView || (viewMetadata?.view_id === viewId ? viewMetadata : undefined);
  const activeView = activeOutlineView || (activeViewId === viewId ? view : undefined);
  const { t } = useTranslation();

  const handleClose = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  const handleFetchChatMessages = useCallback(async () => {
    // Only fetch chat messages for AI Chat views
    if (!aiEnabled || !workspaceId || view?.layout !== ViewLayout.AIChat) {
      return;
    }

    try {
      const messages = await AIService.getChatMessages(workspaceId, viewId);

      setHasMessages(messages.messages.length > 0);
    } catch {
      // do nothing
    }
  }, [aiEnabled, workspaceId, viewId, view?.layout]);

  useEffect(() => {
    void handleFetchChatMessages();
  }, [handleFetchChatMessages]);

  const ChatOptions = useMemo(() => {
    return aiEnabled && view?.layout === ViewLayout.AIChat ? (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuItem
              onClick={() => {
                if (hasMessages) {
                  onOpenSelectionMode();
                  handleClose();
                }
              }}
              className={hasMessages ? '' : '!cursor-default !text-text-tertiary hover:!bg-fill-content'}
            >
              <AddToPageIcon />
              {t('web.addMessagesToPage')}
            </DropdownMenuItem>
          </TooltipTrigger>
          {!hasMessages && <TooltipContent>{t('web.addMessagesToPageDisabled')}</TooltipContent>}
        </Tooltip>
        <DropdownMenuSeparator />
      </>
    ) : null;
  }, [aiEnabled, view?.layout, hasMessages, t, onOpenSelectionMode, handleClose]);

  const handleOpenHistory = useCallback(() => {
    handleClose();
    setHistoryOpen(true);
  }, [handleClose]);

  useEffect(() => {
    setHistoryOpen(false);
  }, [viewId]);

  const pageHistoryEnabled = usePageHistoryEnabled();
  const isDatabasePage = !!view && isDatabaseLayout(view.layout) && (rowId === undefined || rowId === null);
  const showDatabaseHistory = databaseHistoryEnabled && isDatabasePage && !!reloadDatabaseAfterRestore && !!user?.uid;
  const showHistory = (pageHistoryEnabled && view?.layout === ViewLayout.Document) || showDatabaseHistory;

  useEffect(() => {
    setDatabaseId(undefined);
    if (!showDatabaseHistory || !workspaceId || (!open && !historyOpen)) return;
    let cancelled = false;
    const metadataId = getDatabaseIdFromExtra(activeView) || getDatabaseIdFromExtra(view);

    if (metadataId) {
      setDatabaseId(metadataId);
      return;
    }

    void getDatabaseIdFromWorkspaceCatalog(workspaceId, activeViewId || viewId)
      .then((id) => { if (!cancelled && id) setDatabaseId(id); })
      .catch(() => { /* An unresolved identity must not fall back to the folder ID. */ });
    return () => { cancelled = true; };
  }, [showDatabaseHistory, workspaceId, open, historyOpen, activeView, activeViewId, view, viewId]);

  const eventEmitter = useEventEmitter();
  const isDocument = view?.layout === ViewLayout.Document;
  const handleFindAndReplace = useCallback(() => {
    handleClose();
    eventEmitter?.emit(APP_EVENTS.FIND_AND_REPLACE, { viewId });
  }, [eventEmitter, viewId, handleClose]);

  useEffect(() => {
    if (!showHistory && historyOpen) {
      setHistoryOpen(false);
    }
  }, [showHistory, historyOpen]);

  if (aiEnabled && view?.layout === ViewLayout.AIChat && selectionMode) {
    return null;
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button data-testid='page-more-actions' size={'icon'} variant={'ghost'} className={'text-icon-secondary'}>
            <MoreIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent {...menuContentProps}>
          {open && (
            <PermissionedMoreActionsContent
              chatOptions={ChatOptions}
              databaseId={showDatabaseHistory ? databaseId : undefined}
              activeViewId={activeViewId}
              activeView={activeView}
              handleClose={handleClose}
              isDocument={isDocument}
              onDeleted={onDeleted}
              onFindAndReplace={handleFindAndReplace}
              onOpenHistory={handleOpenHistory}
              showHistory={showHistory}
              view={view}
              viewId={viewId}
            />
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {showHistory && historyOpen && (
        <Suspense fallback={null}>
          {isDocument ? (
            <DocumentHistoryModal open={historyOpen} onOpenChange={setHistoryOpen} viewId={viewId} view={view} />
          ) : databaseId && workspaceId && user?.uid && reloadDatabaseAfterRestore ? (
            <DatabaseHistoryModal key={`${workspaceId}:${databaseId}:${user.uid}`} open={historyOpen}
              onOpenChange={setHistoryOpen} workspaceId={workspaceId} databaseId={databaseId}
              databasePageId={viewId} activeViewId={activeViewId} userId={user.uid} name={view?.name}
              onRestored={reloadDatabaseAfterRestore} />
          ) : null}
        </Suspense>
      )}
    </>
  );
}

export default MoreActions;
