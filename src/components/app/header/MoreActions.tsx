import { ViewLayout } from '@/application/types';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { Popover } from '@/components/_shared/popover';
import { useAIChatContext } from '@/components/ai-chat/AIChatProvider';
import { useAppView, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import DocumentInfo from '@/components/app/header/DocumentInfo';
import { Button, Divider, IconButton, Tooltip } from '@mui/material';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MoreActionsContent from './MoreActionsContent';
import { ReactComponent as AddToPageIcon } from '@/assets/icons/add_to_page.svg';
import { useService } from '@/components/main/app.hooks';

function MoreActions({ viewId, onDeleted }: { viewId: string; onDeleted?: () => void }) {
  const workspaceId = useCurrentWorkspaceId();
  const service = useService();
  const { selectionMode, onOpenSelectionMode } = useAIChatContext();
  const [hasMessages, setHasMessages] = useState(false);

  const view = useAppView(viewId);
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const open = Boolean(anchorEl);

  const { t } = useTranslation();

  const handleFetchChatMessages = useCallback(async () => {
    if(!workspaceId || !service) {
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
        <Tooltip title={hasMessages ? '' : t('web.addMessagesToPageDisabled')} placement='top' >
          <div>
            <Button
              size={'small'}
              className={'justify-start px-3 py-1 w-full'}
              color={'inherit'}
              disabled={!hasMessages}
              onClick={() => {
                onOpenSelectionMode();
                handleClose();
              }}
              startIcon={<AddToPageIcon />}
            >
              {t('web.addMessagesToPage')}
            </Button>
          </div>
        </Tooltip>
        <Divider />
      </>
    ) : null;
  }, [view?.layout, hasMessages, t, onOpenSelectionMode]);

  if (view?.layout === ViewLayout.AIChat && selectionMode) {
    return null;
  }

  return (
    <>
      <IconButton onClick={handleClick} size={'small'}>
        <MoreIcon className={'text-text-caption'} />
      </IconButton>
      {open && (
        <Popover
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'right',
          }}
          transformOrigin={{
            vertical: 'top',
            horizontal: 'right',
          }}
          open={open}
          anchorEl={anchorEl}
          onClose={handleClose}
          slotProps={{ root: { className: 'text-sm' } }}
          sx={{
            '& .MuiPopover-paper': {
              width: '268px',
              margin: '10px',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            },
          }}
        >
          {ChatOptions}
          <MoreActionsContent
            itemClicked={() => {
              handleClose();
            }}
            onDeleted={onDeleted}
            viewId={viewId}
            movePopoverOrigins={{
              transformOrigin: {
                vertical: 'top',
                horizontal: 'right',
              },
              anchorOrigin: {
                vertical: 'top',
                horizontal: -20,
              },
            }}
          />
          {open && <DocumentInfo viewId={viewId} />}
        </Popover>
      )}
    </>
  );
}

export default MoreActions;
