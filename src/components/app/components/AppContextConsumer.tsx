import React, { memo, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useActiveRowPage } from '@/application/row-document/row-page-state';
import { AIChatProvider } from '@/components/ai-chat/AIChatProvider';
import { AppOverlayProvider } from '@/components/app/app-overlay/AppOverlayProvider';
import { useAppViewId, useCurrentWorkspaceId, useEventEmitter } from '@/components/app/app.hooks';
import { RequestAccessError } from '@/components/app/hooks/useWorkspaceData';
import RequestAccess from '@/components/app/landing-pages/RequestAccess';
import { InlineCommentComposer } from '@/components/inline-comment/InlineCommentComposer';
import { InlineCommentProvider } from '@/components/inline-comment/InlineCommentContext';
import { useCurrentUser } from '@/components/main/app.hooks';

const ViewModal = React.lazy(() => import('@/components/app/ViewModal'));

interface AppContextConsumerProps {
  children: React.ReactNode;
  requestAccessError: RequestAccessError | null;
  openModalViewId?: string;
  setOpenModalViewId: (id: string | undefined) => void;
}

// Thin UI shell — context providers are handled by AppBusinessLayer
export const AppContextConsumer: React.FC<AppContextConsumerProps> = memo(
  ({ children, requestAccessError, openModalViewId, setOpenModalViewId }) => {
    const closeModal = useCallback(() => setOpenModalViewId(undefined), [setOpenModalViewId]);

    return (
      <AIChatProvider>
        <AppOverlayProvider>
          {/* The provider wraps the page modal as well: its editor has to be able
              to register, otherwise selecting text there offers no comment entry. */}
          <InlineCommentScope openModalViewId={openModalViewId}>
            {requestAccessError ? <RequestAccess error={requestAccessError} /> : children}
            {
              <Suspense>
                <ViewModal
                  open={!!openModalViewId}
                  viewId={openModalViewId}
                  onClose={closeModal}
                />
              </Suspense>
            }
            <InlineCommentComposer />
          </InlineCommentScope>
          {<OpenClient />}
        </AppOverlayProvider>
      </AIChatProvider>
    );
  }
);

/**
 * Scopes inline comments to whichever document is in front: the page modal, the
 * full-page row document (?r=), or the routed view.
 */
function InlineCommentScope({ children, openModalViewId }: { children: React.ReactNode; openModalViewId?: string }) {
  const eventEmitter = useEventEmitter();
  const routeViewId = useAppViewId();
  const workspaceId = useCurrentWorkspaceId();
  const [searchParams] = useSearchParams();
  const rowPageRowId = searchParams.get('r');
  const activeRowPage = useActiveRowPage();
  // On a full-page row (?r=), the comments belong to the row document — the
  // route view is the containing database. Matches the desktop row page, which
  // hosts the inline comment panel for the row's document.
  const rowPageDocumentId = rowPageRowId && activeRowPage?.rowId === rowPageRowId ? activeRowPage.documentId : undefined;
  const viewId = openModalViewId ?? rowPageDocumentId ?? routeViewId;

  return (
    <InlineCommentProvider
      // Keyed by the route view only: opening the modal or a full-page row swaps
      // `viewId` while staying on the same route, and remounting here would tear
      // down the whole app shell underneath it.
      key={`${workspaceId ?? ''}:${routeViewId ?? ''}`}
      eventEmitter={eventEmitter}
      viewId={viewId}
      workspaceId={workspaceId}
    >
      {children}
    </InlineCommentProvider>
  );
}

function OpenClient() {
  const currentWorkspaceId = useCurrentWorkspaceId();
  const viewId = useAppViewId();
  const [searchParams] = useSearchParams();
  const openClient = searchParams.get('is_desktop') === 'true';
  const rowId = searchParams.get('r');
  const currentUser = useCurrentUser();

  const [isTabVisible, setIsTabVisible] = useState(true);
  const hasOpenedRef = useRef(false);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsTabVisible(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    setIsTabVisible(document.visibilityState === 'visible');

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!openClient) {
      hasOpenedRef.current = false;
      return;
    }

    if (isTabVisible && currentUser && !hasOpenedRef.current) {
      window.open(
        `appflowy-flutter://open-page?workspace_id=${currentWorkspaceId}&view_id=${viewId}&email=${currentUser.email}${
          rowId ? `&row_id=${rowId}` : ''
        }`,
        '_self'
      );
      hasOpenedRef.current = true;
    }
  }, [currentWorkspaceId, viewId, currentUser, openClient, rowId, isTabVisible]);

  return <></>;
}
