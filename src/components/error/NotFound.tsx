import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as NoAccessLogo } from '@/assets/icons/no_access.svg';
import LandingPage from '@/components/_shared/landing-page/LandingPage';
import { getPublishError } from '@/utils/publish-error';

const NotFound = () => {
  const { t } = useTranslation();
  const publishError = useMemo(() => getPublishError(), []);

  return (
    <div data-testid={'public-not-found'}>
      <LandingPage
        Logo={NoAccessLogo}
        title={t('landingPage.noAccess.title')}
        description={
          <>
            {publishError && (
              <div className='mb-4 w-full rounded-lg border border-border-primary bg-fill-content p-4 text-left text-sm text-text-primary'>
                <div className='font-semibold text-text-action'>{t('landingPage.noAccess.title')}</div>
                <p className='mt-1 break-words text-text-secondary'>{publishError.message}</p>
                {publishError.detail && (
                  <p className='mt-2 break-words text-xs text-text-secondary'>{publishError.detail}</p>
                )}
                {(publishError.namespace || publishError.publishName) && (
                  <p className='mt-2 text-xs text-text-tertiary'>
                    {publishError.namespace && (
                      <>
                        Namespace: <code className='text-xs'>{publishError.namespace}</code>
                      </>
                    )}
                    {publishError.publishName && (
                      <>
                        {' '}
                        · Publish page: <code className='text-xs'>{publishError.publishName}</code>
                      </>
                    )}
                  </p>
                )}
              </div>
            )}
            <div className='w-full text-center'>
              {t('publish.createWithAppFlowy')}
              <div className={'flex w-full items-center justify-center gap-1'}>
                <div className={'font-semibold text-text-action'}>{t('publish.fastWithAI')}</div>
                <div>{t('publish.tryItNow')}</div>
              </div>
            </div>
          </>
        }
        primaryAction={{
          onClick: () => window.open('https://appflowy.com/download', '_self'),
          label: t('publish.downloadApp'),
        }}
        secondaryAction={{
          onClick: () => window.open('/app', '_self'),
          label: t('landingPage.backToHome'),
        }}
      />
    </div>
  );
};

export default NotFound;
