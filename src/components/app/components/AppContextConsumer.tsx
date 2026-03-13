import React, { memo, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { AIChatProvider } from '@/components/ai-chat/AIChatProvider';
import { AppOverlayProvider } from '@/components/app/app-overlay/AppOverlayProvider';
import { useAppViewId, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { RequestAccessError } from '@/components/app/hooks/useWorkspaceData';
import RequestAccess from '@/components/app/landing-pages/RequestAccess';
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
          {<OpenClient />}
        </AppOverlayProvider>
      </AIChatProvider>
    );
  }
);

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
