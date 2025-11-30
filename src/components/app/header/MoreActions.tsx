import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Role, ViewLayout } from '@/application/types';
import { ReactComponent as AddToPageIcon } from '@/assets/icons/add_to_page.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { findViewInShareWithMe } from '@/components/_shared/outline/utils';
import { useAIChatContext } from '@/components/ai-chat/AIChatProvider';
import { useAppOutline, useAppView, useCurrentWorkspaceId, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import DocumentInfo from '@/components/app/header/DocumentInfo';
import { useService } from '@/components/main/app.hooks';
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

function MoreActions({
  viewId,
  onDeleted,
  menuContentProps,
}: {
  viewId: string;
  onDeleted?: () => void;
  menuContentProps?: React.ComponentProps<typeof DropdownMenuContent>;
} & React.ComponentProps<typeof DropdownMenu>) {
  const workspaceId = useCurrentWorkspaceId();
  const service = useService();
  const { selectionMode, onOpenSelectionMode } = useAIChatContext();
  const [hasMessages, setHasMessages] = useState(false);
  const [open, setOpen] = useState(false);
  const outline = useAppOutline();

  const view = useAppView(viewId);
  const { t } = useTranslation();

  const handleClose = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  const handleFetchChatMessages = useCallback(async () => {
    // Only fetch chat messages for AI Chat views
    if (!workspaceId || !service || view?.layout !== ViewLayout.AIChat) {
      return;
    }

    try {
      const messages = await service.getChatMessages(workspaceId, viewId);

      setHasMessages(messages.messages.length > 0);
    } catch {
      // do nothing
    }
  }, [workspaceId, service, viewId, view?.layout]);

  useEffect(() => {
    void handleFetchChatMessages();
  }, [handleFetchChatMessages]);

  const userWorkspaceInfo = useUserWorkspaceInfo();

  const role = userWorkspaceInfo?.selectedWorkspace.role;

  const ChatOptions = useMemo(() => {
    return view?.layout === ViewLayout.AIChat ? (
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
  }, [view?.layout, hasMessages, t, onOpenSelectionMode, handleClose]);

  const shareWithMeView = useMemo(() => {
    return findViewInShareWithMe(outline || [], viewId);
  }, [outline, viewId]);

  if (view?.layout === ViewLayout.AIChat && selectionMode) {
    return null;
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button data-testid='page-more-actions' size={'icon'} variant={'ghost'} className={'text-icon-secondary'}>
          <MoreIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent {...menuContentProps}>
        <DropdownMenuGroup>{ChatOptions}</DropdownMenuGroup>

        {role === Role.Guest || shareWithMeView ? null : (
          <>
            <MoreActionsContent
              itemClicked={() => {
                handleClose();
              }}
              onDeleted={onDeleted}
              viewId={viewId}
            />
            <DropdownMenuSeparator />
          </>
        )}

        <DocumentInfo viewId={viewId} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default MoreActions;
