import { useAIChatContext } from '@/components/ai-chat/AIChatProvider';
import { Button } from '@mui/material';
import React from 'react';
import { ReactComponent as EditIcon } from '@/assets/edit.svg';

function Pinned() {
  const {
    setDrawerOpen,
  } = useAIChatContext();

  return (
    <div className={'absolute top-1/3 shadow-md left-0 -translate-x-[60%] transform'}>
      <Button
        onClick={() => setDrawerOpen(true)}
        variant={'outlined'}
        color={'inherit'}
        className={'py-2 rounded-[12px] !pl-2'}
        startIcon={<EditIcon />}
      >
      </Button>
    </div>
  );
}

export default Pinned;