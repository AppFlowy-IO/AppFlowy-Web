import { useOutlineDrawer } from '@/components/_shared/outline/outline.hooks';
import { AFScroller } from '@/components/_shared/scroller';
import { useAIChatContext } from '@/components/ai-chat/AIChatProvider';
import { useViewErrorStatus } from '@/components/app/app.hooks';
import { AppHeader } from '@/components/app/header';
import Main from '@/components/app/Main';
import SideBar from '@/components/app/SideBar';
import DeletedPageComponent from '@/components/error/PageHasBeenDeleted';
import RecordNotFound from '@/components/error/RecordNotFound';
import SomethingError from '@/components/error/SomethingError';
import React, { useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

function MainLayout () {
  const {
    drawerOpened,
    drawerWidth,
    setDrawerWidth,
    toggleOpenDrawer,
  } = useOutlineDrawer();
  const {
    drawerOpen: chatViewDrawerOpen,
    drawerWidth: openViewDrawerWidth,
  } = useAIChatContext();

  const { notFound, deleted } = useViewErrorStatus();

  const main = useMemo(() => {
    if (deleted) {
      return <DeletedPageComponent />;
    }

    return notFound ? <RecordNotFound isViewNotFound /> : <Main />;
  }, [deleted, notFound]);

  const width = useMemo(() => {
    let diff = 0;

    if (drawerOpened) {
      diff = drawerWidth;
    }

    if (chatViewDrawerOpen) {
      diff += openViewDrawerWidth;
    }

    return `calc(100% - ${diff}px)`;
  }, [drawerOpened, drawerWidth, openViewDrawerWidth, chatViewDrawerOpen]);

  return (
    <div className={'h-screen w-screen'}>
      <AFScroller
        overflowXHidden
        overflowYHidden={false}
        style={{
          transform: drawerOpened ? `translateX(${drawerWidth}px)` : 'none',
          width,
          transition: 'width 0.2s ease-in-out, transform 0.2s ease-in-out',
        }}
        className={'appflowy-layout transform flex flex-col appflowy-scroll-container h-full'}
      >
        <AppHeader
          onOpenDrawer={() => {
            toggleOpenDrawer(true);
          }}
          drawerWidth={drawerWidth}
          onCloseDrawer={() => {
            toggleOpenDrawer(false);
          }}
          openDrawer={drawerOpened}
        />
        <div
          className={'sticky-header-overlay'}
          style={{
            width: '100%',
            position: 'sticky',
            top: 48,
            left: 0,
            right: 0,
            zIndex: 50,
          }}
        />

        <ErrorBoundary FallbackComponent={SomethingError}>
          {main}
        </ErrorBoundary>

      </AFScroller>
      <SideBar
        onResizeDrawerWidth={setDrawerWidth}
        drawerWidth={drawerWidth}
        drawerOpened={drawerOpened}
        toggleOpenDrawer={toggleOpenDrawer}
      />
    </div>
  );
}

export default MainLayout;