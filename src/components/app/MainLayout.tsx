import { useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';

import { ErrorType } from '@/application/utils/error-utils';
import { useOutlineDrawer } from '@/components/_shared/outline/outline.hooks';
import { AFScroller } from '@/components/_shared/scroller';
import { useAIChatContextOptional } from '@/components/ai-chat/AIChatProvider';
import {
  useAppViewId,
  useCurrentWorkspaceId,
  useEventEmitter,
  useOpenModalViewId,
  useViewErrorStatus,
} from '@/components/app/app.hooks';
import { ConnectBanner } from '@/components/app/ConnectBanner';
import { AppHeader } from '@/components/app/header';
import Main from '@/components/app/Main';
import SideBar from '@/components/app/SideBar';
import DeletedPageComponent from '@/components/error/PageHasBeenDeleted';
import RecordNotFound from '@/components/error/RecordNotFound';
import SomethingError from '@/components/error/SomethingError';
import { InlineCommentComposer } from '@/components/inline-comment/InlineCommentComposer';
import {
  INLINE_COMMENT_DRAWER_WIDTH,
  InlineCommentProvider,
  useInlineCommentContext,
} from '@/components/inline-comment/InlineCommentContext';
import { InlineCommentSidebar } from '@/components/inline-comment/InlineCommentSidebar';

function MainLayoutContent() {
  const { drawerOpened, drawerWidth, setDrawerWidth, toggleOpenDrawer } = useOutlineDrawer();
  const aiChatContext = useAIChatContextOptional();
  const chatViewDrawerOpen = aiChatContext?.drawerOpen ?? false;
  const openViewDrawerWidth = aiChatContext?.drawerWidth ?? 0;
  const { isPanelOpen } = useInlineCommentContext();

  const openPageModalViewId = useOpenModalViewId();
  const viewId = useAppViewId();
  const { notFound, deleted, noAccess } = useViewErrorStatus();
  const { t } = useTranslation();

  const main = useMemo(() => {
    if (deleted) {
      return <DeletedPageComponent />;
    }

    if (noAccess) {
      return (
        <RecordNotFound
          viewId={viewId}
          error={{ type: ErrorType.Forbidden, message: t('requestAccess.title') }}
        />
      );
    }

    return notFound ? <RecordNotFound isViewNotFound viewId={viewId} /> : <Main />;
  }, [deleted, noAccess, notFound, t, viewId]);

  const width = useMemo(() => {
    let diff = 0;

    if (drawerOpened) {
      diff = drawerWidth;
    }

    if (chatViewDrawerOpen) {
      diff += openViewDrawerWidth;
    }

    if (isPanelOpen) {
      diff += INLINE_COMMENT_DRAWER_WIDTH;
    }

    return `calc(100% - ${diff}px)`;
  }, [chatViewDrawerOpen, drawerOpened, drawerWidth, isPanelOpen, openViewDrawerWidth]);

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
        className={'appflowy-layout appflowy-scroll-container flex h-full transform flex-col bg-background-primary'}
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
        <ConnectBanner />

        {!openPageModalViewId && (
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
        )}

        <ErrorBoundary FallbackComponent={SomethingError}>{main}</ErrorBoundary>
      </AFScroller>
      <SideBar
        onResizeDrawerWidth={setDrawerWidth}
        drawerWidth={drawerWidth}
        drawerOpened={drawerOpened}
        toggleOpenDrawer={toggleOpenDrawer}
      />
      <InlineCommentSidebar rightOffset={chatViewDrawerOpen ? openViewDrawerWidth : 0} />
    </div>
  );
}

function MainLayout() {
  const eventEmitter = useEventEmitter();
  const viewId = useAppViewId();
  const workspaceId = useCurrentWorkspaceId();

  return (
    <InlineCommentProvider
      key={`${workspaceId ?? ''}:${viewId ?? ''}`}
      eventEmitter={eventEmitter}
      viewId={viewId}
      workspaceId={workspaceId}
    >
      <MainLayoutContent />
      <InlineCommentComposer />
    </InlineCommentProvider>
  );
}

export default MainLayout;
