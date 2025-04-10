import { AFConfigContext } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import React, { useContext, useState } from 'react';
import { ReactComponent as Logo } from '@/assets/icons/logo.svg';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

function CheckEmail ({ email, redirectTo }: {
  email: string;
  redirectTo: string;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string>('');
  const [isEnter, setEnter] = useState<boolean>(false);
  const [code, setCode] = useState<string>('');
  const service = useContext(AFConfigContext)?.service;
  const handleSubmit = async () => {
    if (!code) {
      setError(t('requireCode'));
      return;
    }

    const id = toast.loading(t('signing'));

    try {
      await service?.signInOTP({
        email,
        redirectTo,
        code,
      });
      // eslint-disable-next-line
    } catch (e: any) {
      console.log(e);
      setError(e.message);
    } finally {
      toast.dismiss(id);
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
            onChange={(e) => {
              setError('');
              setCode(e.target.value);
            }}
            value={code}
            placeholder={t('enterCode')}
            helpText={error}
            variant={error ? 'destructive' : 'default'}
            onKeyDown={e => {
              if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
                void handleSubmit();
              }
            }}
          />

          <Button
            onClick={handleSubmit}
            size={'lg'}
            className={'w-[320px]'}
          >
            {t('continueToSignIn')}
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