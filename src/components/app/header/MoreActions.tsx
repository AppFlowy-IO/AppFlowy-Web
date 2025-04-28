import { ViewLayout } from '@/application/types';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { useAIChatContext } from '@/components/ai-chat/AIChatProvider';
import { useAppView, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import DocumentInfo from '@/components/app/header/DocumentInfo';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MoreActionsContent from './MoreActionsContent';
import { ReactComponent as AddToPageIcon } from '@/assets/icons/add_to_page.svg';
import { useService } from '@/components/main/app.hooks';
import { Tooltip, TooltipContent } from '@/components/ui/tooltip';

function MoreActions ({ viewId, onDeleted, menuContentProps }:
  {
    viewId: string;
    onDeleted?: () => void;
    menuContentProps?: React.ComponentProps<typeof DropdownMenuContent>
  } & React.ComponentProps<typeof DropdownMenu>,
) {
  const workspaceId = useCurrentWorkspaceId();
  const service = useService();
  const { selectionMode, onOpenSelectionMode } = useAIChatContext();
  const [hasMessages, setHasMessages] = useState(false);
  const [open, setOpen] = useState(false);

  const view = useAppView(viewId);
  const { t } = useTranslation();

  const handleClose = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  const handleFetchChatMessages = useCallback(async () => {
    if (!workspaceId || !service) {
      return;
    }

    try {
      const messages = await service.getChatMessages(workspaceId, viewId);

      setHasMessages(messages.messages.length > 0);
    } catch {
      // do nothing
    }
  }, [workspaceId, service, viewId]);

  useEffect(() => {
    void handleFetchChatMessages();
  }, [handleFetchChatMessages]);

  const ChatOptions = useMemo(() => {
    return view?.layout === ViewLayout.AIChat ? (
      <>
        <Tooltip>
          <div>
            <Button
              disabled={!hasMessages}
              onClick={() => {
                onOpenSelectionMode();
                handleClose();
              }}
            >
              <AddToPageIcon />
              {t('web.addMessagesToPage')}
            </Button>
          </div>
          <TooltipContent>
            {hasMessages ? '' : t('web.addMessagesToPageDisabled')}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuSeparator />
      </>
    ) : null;
  }, [view?.layout, hasMessages, t, onOpenSelectionMode, handleClose]);

  if (view?.layout === ViewLayout.AIChat && selectionMode) {
    return null;
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuTrigger asChild>
        <Button
          size={'icon'}
          variant={'ghost'}
          className={'text-icon-secondary'}
        >
          <MoreIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent {...menuContentProps}>
        <DropdownMenuGroup>
          {ChatOptions}
        </DropdownMenuGroup>

        <MoreActionsContent
          itemClicked={() => {
            handleClose();
          }}
          onDeleted={onDeleted}
          viewId={viewId}
        />
        <DropdownMenuSeparator />
        <DocumentInfo viewId={viewId} />
      </DropdownMenuContent>

    </DropdownMenu>
  );
}

export default MoreActions;
