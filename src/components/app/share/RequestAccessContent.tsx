import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { ReactComponent as NoAccessLogo } from '@/assets/icons/no_access.svg';
import { ReactComponent as SuccessLogo } from '@/assets/icons/success_logo.svg';
import { useAppViewId, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { RequestAccessError } from '@/components/app/hooks/useWorkspaceData';
import { useCurrentUser, useService } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

const REPEAT_REQUEST_CODE = 1043;

interface RequestAccessContentProps {
  viewId?: string;
  workspaceId?: string;
  error?: RequestAccessError;
}

export function RequestAccessContent({ viewId: propViewId, workspaceId: propWorkspaceId, error: _error }: RequestAccessContentProps) {
  const { t } = useTranslation();
  const service = useService();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const appViewId = useAppViewId();
  const [searchParams] = useSearchParams();
  const isGuest = searchParams.get('is_guest') === 'true';
  const [hasSend, setHasSend] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const currentUser = useCurrentUser();

  // Use props if provided, otherwise fall back to hooks
  const viewId = propViewId || appViewId;
  const workspaceId = propWorkspaceId || currentWorkspaceId;

  const handleSendRequest = async () => {
    try {
      if (!service) return;
      if (!workspaceId || !viewId) {
        setIsError(true);
        return;
      }

      setLoading(true);
      await service.sendRequestAccess(workspaceId, viewId);

      toast.success(t('landingPage.noAccess.requestAccessSuccess'));
      setHasSend(true);
      // eslint-disable-next-line
    } catch (e: any) {
      if (e.code === REPEAT_REQUEST_CODE) {
        toast.error(t('requestAccess.repeatRequestError'));
      } else {
        toast.error(e.message);
        setIsError(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = () => {
    setIsError(false);
    void handleSendRequest();
  };

  const handleBackToHome = () => {
    window.open('/app', '_self');
  };

  useEffect(() => {
    if (isGuest && currentUser) {
      window.open(
        `appflowy-flutter://open-page?workspace_id=${workspaceId}&view_id=${viewId}&email=${currentUser.email}`,
        '_self'
      );
    }
  }, [isGuest, workspaceId, viewId, currentUser]);

  const description = isGuest
    ? `${t(
        'landingPage.noAccess.description'
      )}\n\n Guests invited to this page can access it via the desktop or mobile app.`
    : t('landingPage.noAccess.description');

  if (hasSend) {
    return (
      <div className='flex h-full w-full flex-col items-center justify-center px-4'>
        <div className='flex w-[400px] flex-col items-center justify-center gap-10'>
          <div className='flex w-full flex-col items-center justify-center gap-6'>
            <SuccessLogo className='h-16 w-16' />
            <div className='w-full whitespace-pre-wrap break-words text-center text-xl font-bold text-text-primary'>
              {t('landingPage.noAccess.requestAccessSuccess')}
            </div>
            <div className='w-[320px] whitespace-pre-wrap break-words text-center text-sm text-text-primary'>
              {t('landingPage.noAccess.requestAccessSuccessMessage')}
            </div>
            <div className='flex w-[320px] flex-col gap-[10px]'>
              <Button onClick={handleBackToHome} size='lg' className='w-full min-w-full' variant='outline'>
                {t('landingPage.backToHome')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className='flex h-full w-full flex-col items-center justify-center px-4'>
        <div className='flex w-[400px] flex-col items-center justify-center gap-10'>
          <div className='flex w-full flex-col items-center justify-center gap-6'>
            <div className='w-full whitespace-pre-wrap break-words text-center text-xl font-bold text-text-primary'>
              {t('landingPage.error.title')}
            </div>
            <div className='w-[320px] whitespace-pre-wrap break-words text-center text-sm text-text-primary'>
              {t('landingPage.error.description')}
            </div>
            <div className='flex w-[320px] flex-col gap-[10px]'>
              <Button onClick={handleRetry} size='lg' className='w-full min-w-full' variant='default'>
                {t('landingPage.error.retry')}
              </Button>
              <Button onClick={handleBackToHome} size='lg' className='w-full min-w-full' variant='outline'>
                {t('landingPage.backToHome')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='flex h-full w-full flex-col items-center justify-center px-4'>
      <div className='flex w-[400px] flex-col items-center justify-center gap-10'>
        <div className='flex w-full flex-col items-center justify-center gap-6'>
          <NoAccessLogo className='h-16 w-16' />
          <div className='w-full whitespace-pre-wrap break-words text-center text-xl font-bold text-text-primary'>
            {t('landingPage.noAccess.title')}
          </div>
          <div className='w-[320px] whitespace-pre-wrap break-words text-center text-sm text-text-primary'>
            {description}
          </div>
          <div className='flex w-[320px] flex-col gap-[10px]'>
            <Button onClick={handleSendRequest} disabled={loading} size='lg' className='w-full min-w-full' variant='default'>
              {loading ? (
                <span className='flex items-center gap-2'>
                  <Progress />
                  {t('landingPage.noAccess.requestAccess')}
                </span>
              ) : (
                t('landingPage.noAccess.requestAccess')
              )}
            </Button>
            <Button onClick={handleBackToHome} size='lg' className='w-full min-w-full' variant='outline'>
              {t('landingPage.backToHome')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
