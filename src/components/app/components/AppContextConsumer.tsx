import React, { memo, Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Awareness } from 'y-protocols/awareness';

import { AIChatProvider } from '@/components/ai-chat/AIChatProvider';
import { AppOverlayProvider } from '@/components/app/app-overlay/AppOverlayProvider';
import { AppContext, useAppViewId, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { RequestAccessError } from '@/components/app/hooks/useWorkspaceData';
import RequestAccess from '@/components/app/landing-pages/RequestAccess';
import { useCurrentUser } from '@/components/main/app.hooks';

import { useAllContextData } from '../hooks/useAllContextData';

const ViewModal = React.lazy(() => import('@/components/app/ViewModal'));

interface AppContextConsumerProps {
  children: React.ReactNode;
  requestAccessError: RequestAccessError | null;
  openModalViewId?: string;
  setOpenModalViewId: (id: string | undefined) => void;
  awarenessMap: Record<string, Awareness>;
}

// Component that consumes all internal contexts and provides the unified AppContext
// This maintains the original AppContext API while using the new layered architecture internally
export const AppContextConsumer: React.FC<AppContextConsumerProps> = memo(
  ({ children, requestAccessError, openModalViewId, setOpenModalViewId, awarenessMap }) => {
    // Merge all layer data into the complete AppContextType
    const allContextData = useAllContextData(awarenessMap);

    return (
      <AppContext.Provider value={allContextData}>
        <AIChatProvider>
          <AppOverlayProvider>
            {requestAccessError ? <RequestAccess error={requestAccessError} /> : children}
            {
              <Suspense>
                <ViewModal
                  open={!!openModalViewId}
                  viewId={openModalViewId}
                  onClose={() => {
                    setOpenModalViewId(undefined);
                  }}
                />
              </Suspense>
            }
            {<OpenClient />}
          </AppOverlayProvider>
        </AIChatProvider>
      </AppContext.Provider>
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
  const prevOpenClientRef = useRef(openClient);

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
    if (isTabVisible && openClient && currentUser) {
      if (!prevOpenClientRef.current) {
        window.open(
          `appflowy-flutter://open-page?workspace_id=${currentWorkspaceId}&view_id=${viewId}&email=${currentUser.email}${
            rowId ? `&row_id=${rowId}` : ''
          }`,
          '_self'
        );
      }
    }

    prevOpenClientRef.current = openClient;
  }, [currentWorkspaceId, viewId, currentUser, openClient, rowId, isTabVisible]);

  return <></>;
}
