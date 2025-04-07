import { notify } from '@/components/_shared/notify';
import { AFConfigContext } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import React, { useContext, useState } from 'react';
import { ReactComponent as Logo } from '@/assets/icons/logo.svg';
import { useTranslation } from 'react-i18next';

function CheckEmail ({ email, redirectTo }: {
  email: string;
  redirectTo: string;
}) {
  const { t } = useTranslation();
  const [isEnter, setEnter] = useState<boolean>(false);
  const [code, setCode] = useState<string>('');
  const [loading, setLoading] = React.useState<boolean>(false);
  const service = useContext(AFConfigContext)?.service;
  const handleSubmit = async () => {
    setLoading(true);

    try {
      await service?.signInOTP({
        email,
        redirectTo,
        code,
      });
    } catch (e) {
      notify.error(t('web.signInError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={'flex flex-col gap-5 items-center justify-center w-full px-4'}>
      <div
        onClick={() => {
          window.location.href = '/';
        }}
        className={'flex cursor-pointer'}
      >
        <Logo className={'h-10 w-10'} />
      </div>
      <div className={'text-xl text-text-primary font-semibold'}>
        {t('checkYourEmail')}
      </div>
      <div className={'flex text-sm w-[320px] text-center items-center flex-col justify-center'}>
        <div className={'font-normal'}>{t('checkEmailTip')}</div>
        <div className={'font-semibold'}>
          {email}
        </div>
      </div>
      {isEnter ? (
        <div className={'flex flex-col gap-3'}>
          <Input
            autoFocus
            size={'md'}
            className={'w-[320px]'}
            onChange={(e) => setCode(e.target.value)}
            value={code}
            placeholder={t('enterCode')}
          />

          <Button
            onClick={handleSubmit}
            disabled={loading}
            size={'lg'}
            className={'w-[320px]'}
          >
            {loading ? (
              <>
                <Progress size={'sm'} />
                {t('editor.loading')}...
              </>
            ) : (
              t('continueToSignIn')
            )}
          </Button>
        </div>
      ) : <Button
        size={'lg'}
        className={'w-[320px]'}
        onClick={() => setEnter(true)}
      >
        {t('enterCodeManually')}
      </Button>}

      <Button
        size={'lg'}
        variant={'ghost'}
        onClick={() => {
          window.location.href = `/login?redirectTo=${redirectTo}`;
        }}
        className={'w-[320px] hover:bg-transparent text-text-theme hover:text-text-theme-hover h-5'}
      >
        {t('backToLogin')}
      </Button>
    </div>
  );
}

export default CheckEmail;