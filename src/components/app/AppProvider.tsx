import { useContext, useState, type ReactNode } from 'react';

import { determineErrorType, ErrorType } from '@/application/utils/error-utils';
import { ReactComponent as ErrorIcon } from '@/assets/icons/error.svg';
import { FullScreenLoading } from '@/components/_shared/FullScreenLoading';
import { AFConfigContext } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

import { AuthInternalContext } from './contexts/AuthInternalContext';
import { AppAuthLayer } from './layers/AppAuthLayer';
import { AppBusinessLayer } from './layers/AppBusinessLayer';
import { AppSyncLayer } from './layers/AppSyncLayer';

function WorkspaceBootstrapError({ error, onRetry }: { error: Error; onRetry?: () => void | Promise<unknown> }) {
  const [retrying, setRetrying] = useState(false);
  const appError = determineErrorType(error);
  const isNetworkError = appError.type === ErrorType.NetworkError;

  const handleRetry = async () => {
    if (!onRetry) {
      window.location.reload();
      return;
    }

    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className='fixed inset-0 flex items-center justify-center bg-background-primary px-6'>
      <div role='alert' className='flex max-w-md flex-col items-center gap-5 text-center'>
        <ErrorIcon className='h-14 w-14 text-function-error' />
        <div className='flex flex-col gap-2'>
          <h1 className='text-xl font-semibold text-text-primary'>
            {isNetworkError ? 'Unable to reach the server' : 'Unable to load workspace'}
          </h1>
          <p className='text-sm text-text-secondary'>
            {isNetworkError
              ? 'The app will retry automatically when the connection comes back.'
              : appError.message || 'The app could not load your workspace data.'}
          </p>
        </div>
        <Button onClick={handleRetry} disabled={retrying}>
          {retrying ? (
            <span className='flex items-center gap-2'>
              <Progress variant='inherit' />
              Retrying
            </span>
          ) : (
            'Retry'
          )}
        </Button>
      </div>
    </div>
  );
}

// Internal component to conditionally render sync and business layers only when workspace ID exists
const ConditionalWorkspaceLayers = ({ children }: { children: ReactNode }) => {
  const authContext = useContext(AuthInternalContext);
  const { isAuthenticated, userWorkspaceInfo, workspaceInfoError, retryLoadWorkspaceInfo } = authContext || {};

  // Unmount user/workspace-scoped providers in the same render that auth is
  // invalidated. AppAuthLayer will redirect to login after this commit.
  if (!isAuthenticated) {
    return <FullScreenLoading label='Loading workspace' />;
  }

  // Show loading animation while workspace ID is being loaded
  if (!userWorkspaceInfo) {
    if (workspaceInfoError) {
      return <WorkspaceBootstrapError error={workspaceInfoError} onRetry={retryLoadWorkspaceInfo} />;
    }

    return <FullScreenLoading label='Loading workspace' />;
  }

  return (
    <AppSyncLayer>
      <AppBusinessLayer>{children}</AppBusinessLayer>
    </AppSyncLayer>
  );
};

// Refactored AppProvider using layered architecture
// External API remains identical - all changes are internal
export const AppProvider = ({ children }: { children: ReactNode }) => {
  const rootConfig = useContext(AFConfigContext);

  return (
    <AppAuthLayer key={rootConfig?.authenticatedUserId ?? 'anonymous'}>
      <ConditionalWorkspaceLayers>{children}</ConditionalWorkspaceLayers>
    </AppAuthLayer>
  );
};
