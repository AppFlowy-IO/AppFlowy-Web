import { useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useCurrentUserOptional, useOpenLoginModalOptional } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';

function LandingFooter() {
  const { t } = useTranslation();
  const openLoginModal = useOpenLoginModalOptional();
  const currentUser = useCurrentUserOptional();

  const url = useMemo(() => {
    return window.location.href;
  }, []);

  return (
    <div className={'flex w-full flex-col items-center justify-center gap-5 text-text-primary'}>
      <div className={'flex w-full flex-col text-center text-sm text-text-secondary'}>
        <span>
          <Trans
            key={'alreadyHaveAccount'}
            i18nKey={'alreadyHaveAccount'}
            components={{
              email: <span className='font-medium text-text-action'>{currentUser?.email || ''}</span>,
            }}
          />
        </span>

        <span>
          <Trans
            i18nKey={'mightNeedToLogin'}
            components={{
              login: (
                <Button
                  onClick={() => {
                    openLoginModal?.(url);
                  }}
                  className={'px-0 text-sm'}
                  variant={'link'}
                >
                  {t('login')}
                </Button>
              ),
            }}
          />
        </span>
      </div>
    </div>
  );
}

export default LandingFooter;
