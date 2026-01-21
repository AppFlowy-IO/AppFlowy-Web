import { useState, useEffect, useContext } from 'react';
import { useTranslation } from 'react-i18next';

import { AuthProvider } from '@/application/types';
import { ReactComponent as ArrowRight } from '@/assets/icons/arrow_right.svg';
import { ReactComponent as Logo } from '@/assets/icons/logo.svg';
import EmailLogin from '@/components/login/EmailLogin';
import LoginProvider from '@/components/login/LoginProvider';
import { AFConfigContext } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { getPlatform } from '@/utils/platform';

export function Login({ redirectTo }: { redirectTo: string }) {
  const { t } = useTranslation();
  const [availableProviders, setAvailableProviders] = useState<AuthProvider[]>([]);
  const service = useContext(AFConfigContext)?.service;

  // Fetch available auth providers on mount
  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const providers = await service?.getAuthProviders();

        setAvailableProviders(providers || []);

      } catch (error) {
        console.error('Failed to fetch auth providers:', error);
        // On error, set empty array (no OAuth providers)
        setAvailableProviders([]);
      }
    };

    void fetchProviders();
  }, [service]);

  // Filter to check if there are any OAuth providers (not EMAIL or PASSWORD)
  const hasOAuthProviders = availableProviders.some(
    provider => ![AuthProvider.EMAIL, AuthProvider.PASSWORD, AuthProvider.MAGIC_LINK].includes(provider)
  );

  const isMobile = getPlatform().isMobile;

  return (
    <div
      style={{
        justifyContent: isMobile ? 'flex-start' : 'between',
      }}
      className={'flex  h-full flex-col items-center justify-between gap-5 px-4 py-10 text-text-primary'}
    >
      <div className={'flex w-full flex-1 flex-col items-center justify-center gap-5'}>
        <div
          onClick={() => {
            window.location.href = '/';
          }}
          className={'flex w-full cursor-pointer flex-col items-center justify-center gap-5'}
        >
          <Logo className={'h-9 w-9'} />
          <div className={'text-xl font-semibold'}>{t('welcomeTo')} AppFlowy</div>
        </div>
        <EmailLogin redirectTo={redirectTo} />
        <div
          className={
            'w-[300px] overflow-hidden whitespace-pre-wrap break-words text-center text-[12px] tracking-[0.36px] text-text-secondary'
          }
        >
          <span>{t('web.signInAgreement')} </span>
          <a
            href={'https://appflowy.com/terms'}
            target={'_blank'}
            className={'text-text-secondary underline'}
            rel='noreferrer'
          >
            {t('web.termOfUse')}
          </a>{' '}
          {t('web.and')}{' '}
          <a
            href={'https://appflowy.com/privacy'}
            target={'_blank'}
            className={'text-text-secondary underline'}
            rel='noreferrer'
          >
            {t('web.privacyPolicy')}
          </a>
          .
        </div>
        {hasOAuthProviders && (
          <div className={'flex w-full items-center justify-center gap-2 text-text-secondary'}>
            <Separator className={'flex-1'} />
            {t('web.or')}
            <Separator className={'flex-1'} />
          </div>
        )}
        <LoginProvider redirectTo={redirectTo} availableProviders={availableProviders} />
        <div className={'flex items-center gap-1 text-sm text-text-secondary'}>
          <span>{t('signIn.dontHaveAnAccount')}</span>
          <Button
            variant={'link'}
            onClick={() => {
              const encodedRedirect = encodeURIComponent(redirectTo);

              window.location.href = `/login?action=signUpPassword&redirectTo=${encodedRedirect}`;
            }}
            className={'px-0 text-text-secondary underline'}
            data-testid="login-create-account-button"
          >
            {t('signIn.createAccount')}
          </Button>
        </div>
      </div>

      <div
        style={{
          marginBottom: isMobile ? 64 : '0',
        }}
        className={'flex w-full flex-col gap-5'}
      >
        <Separator className={'w-[320px] max-w-full'} />
        <div
          onClick={() => {
            window.location.href = 'https://appflowy.com';
          }}
          className={
            'flex w-full cursor-pointer items-center justify-center gap-2 text-xs font-medium text-text-secondary'
          }
        >
          <span>{t('web.visitOurWebsite')}</span>
          <ArrowRight className={'h-5 w-5'} />
        </div>
      </div>
    </div>
  );
}

export default Login;
