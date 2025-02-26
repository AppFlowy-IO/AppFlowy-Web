import { ViewLayout } from '@/application/types';
import { ReactComponent as MoreIcon } from '@/assets/more.svg';
import { Popover } from '@/components/_shared/popover';
import { useAIChatContext } from '@/components/ai-chat/AIChatProvider';
import { useAppView } from '@/components/app/app.hooks';
import DocumentInfo from '@/components/app/header/DocumentInfo';
import { Button, Divider, IconButton } from '@mui/material';
import React from 'react';
import { useTranslation } from 'react-i18next';
import MoreActionsContent from './MoreActionsContent';
import { ReactComponent as DocForwardIcon } from '@/assets/doc-forward.svg';

function MoreActions({
  viewId,
  onDeleted,
}: {
  viewId: string;
  onDeleted?: () => void;
}) {
  const {
    selectionMode,
    onOpenSelectionMode,
  } = useAIChatContext();

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

  if(view?.layout === ViewLayout.AIChat && selectionMode) {
    return null;
  }

  return (
    <>
      <IconButton onClick={handleClick}>
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
          {view?.layout === ViewLayout.AIChat ? <>
            <Button
              size={'small'}
              className={'px-3 py-1 justify-start '}
              color={'inherit'}
              onClick={() => {
                onOpenSelectionMode();
                handleClose();
              }}
              startIcon={<DocForwardIcon />}
            >{t('web.addMessagesToPage')}</Button>
            <Divider />
          </> : null}
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