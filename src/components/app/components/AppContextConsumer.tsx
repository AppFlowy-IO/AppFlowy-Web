import React, { memo, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { AIChatProvider } from '@/components/ai-chat/AIChatProvider';
import { AppOverlayProvider } from '@/components/app/app-overlay/AppOverlayProvider';
import { useAppViewId, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useOpenInDesktopApp } from '@/components/app/hooks/useOpenInDesktopApp';
import { RequestAccessError } from '@/components/app/hooks/useWorkspaceData';
import RequestAccess from '@/components/app/landing-pages/RequestAccess';
import { useCurrentUser } from '@/components/main/app.hooks';
import { buildOpenPageLink, openInDesktopApp } from '@/utils/open_desktop_app';

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

// Captured once per full document load: whether the app was opened directly on a specific page URL
// (i.e. a shared page link). Used so the preference-driven desktop handoff fires only for share
// links opened from outside, not for internal client-side navigation.
const landedOnSpecificPage =
  typeof window !== 'undefined' && /^\/app\/[^/]+\/[^/]+/.test(window.location.pathname);
let didAttemptPreferenceHandoff = false;

function OpenClient() {
  const currentWorkspaceId = useCurrentWorkspaceId();
  const viewId = useAppViewId();
  const [searchParams] = useSearchParams();
  const openClient = searchParams.get('is_desktop') === 'true';
  const rowId = searchParams.get('r');
  const currentUser = useCurrentUser();
  const { enabled } = useOpenInDesktopApp();

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

  // Explicit ?is_desktop=true links (e.g. notification emails) always attempt the deep link.
  useEffect(() => {
    if (!openClient) {
      hasOpenedRef.current = false;
      return;
    }

    if (isTabVisible && currentUser && currentWorkspaceId && viewId && !hasOpenedRef.current) {
      window.open(
        buildOpenPageLink({ workspaceId: currentWorkspaceId, viewId, email: currentUser.email, rowId }),
        '_self'
      );
      hasOpenedRef.current = true;
    }
  }, [currentWorkspaceId, viewId, currentUser, openClient, rowId, isTabVisible]);

  // Preference-driven share-link handoff: when the user prefers the desktop app and this document
  // was opened directly from a shared page link, attempt to open the page in the desktop app once.
  // If the app isn't installed, openInDesktopApp keeps the user on the already-rendered web page.
  useEffect(() => {
    if (openClient || !enabled || !landedOnSpecificPage || didAttemptPreferenceHandoff) return;
    if (!isTabVisible || !currentUser || !currentWorkspaceId || !viewId) return;

    didAttemptPreferenceHandoff = true;
    openInDesktopApp(buildOpenPageLink({ workspaceId: currentWorkspaceId, viewId, email: currentUser.email, rowId }));
  }, [openClient, enabled, currentWorkspaceId, viewId, currentUser, rowId, isTabVisible]);

  return <></>;
}
