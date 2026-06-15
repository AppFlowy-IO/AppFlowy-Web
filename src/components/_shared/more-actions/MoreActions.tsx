import { IconButton } from '@mui/material';
import React from 'react';

import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import MoreActionsContent from '@/components/_shared/more-actions/MoreActionsContent';
import { Popover } from '@/components/_shared/popover';

function MoreActions() {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const open = Boolean(anchorEl);

  return (
    <>
      <IconButton onClick={handleClick}>
        <MoreIcon className={'text-text-secondary'} />
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
        >
          <MoreActionsContent
            itemClicked={() => {
              handleClose();
            }}
          />
        </Popover>
      )}
    </>
  );
}

export default MoreActions;
