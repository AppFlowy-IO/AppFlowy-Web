import LoginProvider from '@/components/login/LoginProvider';
import MagicLink from '@/components/login/MagicLink';
import { Separator } from '@/components/ui/separator';
import React from 'react';
import { ReactComponent as Logo } from '@/assets/icons/logo.svg';
import { useTranslation } from 'react-i18next';
import { ReactComponent as ArrowRight } from '@/assets/icons/arrow_right.svg';

export function Login ({ redirectTo }: { redirectTo: string }) {
  const { t } = useTranslation();

  return (
    <div className={'py-10 flex flex-col h-full items-center justify-between gap-5 px-4'}>
      <div className={'flex flex-1 flex-col items-center justify-center w-full gap-5'}>
        <div
          onClick={() => {
            window.location.href = '/';
          }}
          className={'flex w-full cursor-pointer flex-col items-center justify-center gap-5'}
        >
          <Logo className={'h-9 w-9'} />
          <div className={'text-xl font-semibold'}>{t('welcomeTo')} AppFlowy</div>
        </div>
        <MagicLink redirectTo={redirectTo} />
        <div className={'flex w-full items-center justify-center gap-2 text-text-secondary'}>
          <Separator className={'flex-1'} />
          {t('web.or')}
          <Separator className={'flex-1'} />
        </div>
        <LoginProvider redirectTo={redirectTo} />
        <div
          className={
            'w-[300px] overflow-hidden whitespace-pre-wrap break-words text-center text-[12px] tracking-[0.36px] text-text-secondary'
          }
        >
          <span>{t('web.signInAgreement')} </span>
          <a
            href={'https://appflowy.com/terms'}
            target={'_blank'}
            className={'text-text-theme underline'}
          >
            {t('web.termOfUse')}
          </a>{' '}
          {t('web.and')}{' '}
          <a
            href={'https://appflowy.com/privacy'}
            target={'_blank'}
            className={'text-text-theme underline'}
          >
            {t('web.privacyPolicy')}
          </a>
          .
        </div>
      </div>

      <div className={'flex flex-col w-full gap-5'}>
        <Separator className={'w-[320px] max-w-full'} />
        <div
          onClick={() => {
            window.location.href = 'https://appflowy.com';
          }}
          className={
            'flex w-full cursor-pointer items-center justify-center gap-2 text-xs font-medium text-text-title opacity-60 hover:opacity-100'
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
