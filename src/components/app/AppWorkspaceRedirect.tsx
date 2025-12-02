import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Log } from '@/utils/log';
import LoadingDots from '@/components/_shared/LoadingDots';
import { useUserWorkspaceInfo } from '@/components/app/app.hooks';
import RecordNotFound from '@/components/error/RecordNotFound';

/**
 * Component that handles redirecting from /app to /app/:workspaceId
 * This is used when user lands on /app without a workspace ID (e.g., after OAuth login)
 * Waits for workspace info to load, then redirects to the selected workspace
 * If no workspace exists after loading, shows error instead of infinite loading
 */
export function AppWorkspaceRedirect() {
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const navigate = useNavigate();
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!userWorkspaceInfo) {
      Log.debug('[AppWorkspaceRedirect] Waiting for workspace info to load...');
      return;
    }

    const workspaceId = userWorkspaceInfo.selectedWorkspace?.id;

    if (!workspaceId) {
      console.warn('[AppWorkspaceRedirect] No selected workspace found in user info', userWorkspaceInfo);
      // User has loaded but has no workspace - show error instead of infinite loading
      setHasError(true);
      return;
    }

    Log.debug('[AppWorkspaceRedirect] Redirecting to workspace', { workspaceId });
    navigate(`/app/${workspaceId}`, { replace: true });
  }, [userWorkspaceInfo, navigate]);

  // Show error if workspace info loaded but no workspace exists
  if (hasError) {
    return <RecordNotFound noContent />;
  }

  // Show loading while waiting for workspace info
  return (
    <div className={'flex h-screen w-screen items-center justify-center'}>
      <LoadingDots className='flex items-center justify-center' />
    </div>
  );
}

export default AppWorkspaceRedirect;
