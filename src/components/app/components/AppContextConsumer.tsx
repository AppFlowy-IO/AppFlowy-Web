import React, { memo, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { AIChatProvider } from '@/components/ai-chat/AIChatProvider';
import { AppOverlayProvider } from '@/components/app/app-overlay/AppOverlayProvider';
import { useAppViewId, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useDesktopHandoff } from '@/components/app/hooks/useDesktopHandoff';
import { RequestAccessError } from '@/components/app/hooks/useWorkspaceData';
import RequestAccess from '@/components/app/landing-pages/RequestAccess';
import { useCurrentUser } from '@/components/main/app.hooks';
import { buildOpenPageLink, isSpecificPagePath } from '@/utils/open_desktop_app';

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
  typeof window !== 'undefined' && isSpecificPagePath(window.location.pathname);
let didAttemptPreferenceHandoff = false;

function OpenClient() {
  const currentWorkspaceId = useCurrentWorkspaceId();
  const viewId = useAppViewId();
  const [searchParams] = useSearchParams();
  const openClient = searchParams.get('is_desktop') === 'true';
  const rowId = searchParams.get('r');
  const currentUser = useCurrentUser();
  const { handoff } = useDesktopHandoff();

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

  // Share-link handoff: when this document was opened directly from a shared page link, route it
  // through the preference-gated handoff once. Preference on → opens the desktop app; unset → shows
  // the first-time prompt; off → stays on the already-rendered web page.
  useEffect(() => {
    if (openClient || !landedOnSpecificPage || didAttemptPreferenceHandoff) return;
    if (!isTabVisible || !currentUser || !currentWorkspaceId || !viewId) return;

    didAttemptPreferenceHandoff = true;
    handoff(buildOpenPageLink({ workspaceId: currentWorkspaceId, viewId, email: currentUser.email, rowId }));
  }, [handoff, openClient, currentWorkspaceId, viewId, currentUser, rowId, isTabVisible]);

  return <></>;
}
