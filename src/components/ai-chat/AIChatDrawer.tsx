import React from 'react';

import { useAIChatContext } from '@/components/ai-chat/AIChatProvider';
import DrawerContent from '@/components/ai-chat/DrawerContent';
import DrawerHeader from '@/components/ai-chat/DrawerHeader';
import Pinned from '@/components/ai-chat/Pinned';

import Resizer from './Resizer';

function AIChatDrawer() {
  const { drawerOpen, openViewId, drawerWidth, onSetDrawerWidth } = useAIChatContext();

  return (
    <div className={'fixed right-0 top-0 h-screen transform bg-background-primary transition-transform'}>
      <div
        style={{
          width: drawerOpen ? drawerWidth : 0,
        }}
        className={'h-full overflow-hidden border-l border-line-border'}
      >
        {openViewId && (
          <div className={'appflowy-scroller flex h-full flex-col overflow-auto overflow-x-hidden'}>
            <DrawerHeader />
            <DrawerContent openViewId={openViewId} />
          </div>
        )}

        <Resizer drawerWidth={drawerWidth} onResize={onSetDrawerWidth} />
      </div>

      {!drawerOpen && openViewId && <Pinned />}
    </div>
  );
}

export default React.memo(AIChatDrawer);
