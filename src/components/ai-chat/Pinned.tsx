import { Button } from '@mui/material';
import React, { useCallback } from 'react';

import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { useAIChatContext } from '@/components/ai-chat/AIChatProvider';

function Pinned() {
  const { setDrawerOpen } = useAIChatContext();

  const handleClick = useCallback(() => {
    setDrawerOpen(true);
  }, [setDrawerOpen]);

  return (
    <div className={'absolute top-1/3 shadow-md left-0 -translate-x-[60%] transform'}>
      <Button
        onClick={handleClick}
        variant={'outlined'}
        color={'inherit'}
        className={'py-2 rounded-[12px] !pl-2'}
        startIcon={<EditIcon />}
      >
      </Button>
    </div>
  );
}

export default React.memo(Pinned);