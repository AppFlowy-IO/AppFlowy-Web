import DrawerContent from '@/components/ai-chat/DrawerContent';
import DrawerHeader from '@/components/ai-chat/DrawerHeader';
import Pinned from '@/components/ai-chat/Pinned';
import Resizer from './Resizer';
import { useAIChatContext } from '@/components/ai-chat/AIChatProvider';
import React from 'react';

function AIChatDrawer() {
  const {
    drawerOpen,
    openViewId,
    drawerWidth,
    onSetDrawerWidth,
  } = useAIChatContext();

  return (
    <div
      className={'fixed top-0 bg-bg-body transform right-0 transition-transform  h-screen'}
    >
      <div
        style={{
          width: drawerOpen ? drawerWidth : 0,
        }}
        className={'border-l overflow-hidden border-line-border  h-full'}
      >
        {openViewId &&
          <div className={'flex flex-col h-full overflow-x-hidden appflowy-scroller overflow-auto'}>
            <DrawerHeader />
            <DrawerContent openViewId={openViewId} />
          </div>}

        <Resizer
          drawerWidth={drawerWidth}
          onResize={onSetDrawerWidth}
        />
      </div>

      {!drawerOpen && openViewId && <Pinned />}
    </div>
  );
}

export default AIChatDrawer;