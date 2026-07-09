import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { APP_EVENTS } from '@/application/constants';
import { ViewLayout } from '@/application/types';
import { ReactComponent as AddToPageIcon } from '@/assets/icons/add_to_page.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { useAIChatContext } from '@/components/ai-chat/AIChatProvider';
import { AIService } from '@/application/services/domains';
import {
  useAIEnabled,
  useAppView,
  useCurrentWorkspaceId,
  useEventEmitter,
  usePageHistoryEnabled,
} from '@/components/app/app.hooks';
import DocumentInfo from '@/components/app/header/DocumentInfo';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';
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

function PermissionedMoreActionsContent({
  chatOptions,
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
  handleClose: () => void;
  isDocument: boolean;
  onDeleted?: () => void;
  onFindAndReplace: () => void;
  onOpenHistory: () => void;
  showHistory: boolean;
  view: ReturnType<typeof useAppView>;
  viewId: string;
}) {
  const { canManageViewActions, canUsePageHistory, isLoadingViewActionPermissions } = useViewActionPermissions(
    view,
    true
  );

  return (
    <>
      <DropdownMenuGroup>{chatOptions}</DropdownMenuGroup>

      <MoreActionsContent
        itemClicked={handleClose}
        onDeleted={onDeleted}
        viewId={viewId}
        canManageActions={canManageViewActions}
        canUsePageHistory={canUsePageHistory}
        isLoadingActions={isLoadingViewActionPermissions}
        onOpenHistory={showHistory ? onOpenHistory : undefined}
        onFindAndReplace={isDocument ? onFindAndReplace : undefined}
      />
      <DropdownMenuSeparator />

      <DocumentInfo viewId={viewId} />
    </>
  );
}

function MoreActions({
  viewId,
  onDeleted,
  menuContentProps,
  enableVersionHistory = true,
}: {
  viewId: string;
  onDeleted?: () => void;
  menuContentProps?: ComponentProps<typeof DropdownMenuContent>;
  enableVersionHistory?: boolean;
} & ComponentProps<typeof DropdownMenu>) {
  const workspaceId = useCurrentWorkspaceId();
  const aiEnabled = useAIEnabled();
  const { selectionMode, onOpenSelectionMode } = useAIChatContext();
  const [hasMessages, setHasMessages] = useState(false);
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const view = useAppView(viewId);
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
  const showHistory = enableVersionHistory && pageHistoryEnabled && view?.layout === ViewLayout.Document;

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
          <DocumentHistoryModal open={historyOpen} onOpenChange={setHistoryOpen} viewId={viewId} view={view} />
        </Suspense>
      )}
    </>
  );
}

export default MoreActions;
