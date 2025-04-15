import { AFConfigContext, useCurrentUser } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import React, { useContext, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

function LandingFooter () {
  const { t } = useTranslation();
  const openLoginModal = useContext(AFConfigContext)?.openLoginModal;
  const currentUser = useCurrentUser();

  const url = useMemo(() => {
    return window.location.href;
  }, []);

  return (
    <div className={'flex w-full text-text-primary flex-col gap-5 items-center justify-center'}>
      <Separator />

      <div className={'text-text-secondary flex flex-col text-center text-xs w-full'}>
        {t('alreadyHaveAccount', {
          email: currentUser?.email || '',
        })}
        <br />
        <span>
            <Trans
              i18nKey={'mightNeedToLogin'}
              components={{
                login: <Button
                  onClick={() => {
                    openLoginModal?.(url);
                  }}
                  className={'px-0 text-xs'}
                  variant={'link'}
                >{t('login')}</Button>,
              }}
            />
          </span>

      </div>
    </div>
  );
}

export default LandingFooter;