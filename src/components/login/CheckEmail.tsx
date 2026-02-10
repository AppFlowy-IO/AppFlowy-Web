import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as Logo } from '@/assets/icons/logo.svg';
import { AFConfigContext } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';


function CheckEmail ({ email, redirectTo, otpType }: {
  email: string;
  redirectTo: string;
  otpType?: 'signup';
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string>('');
  const [isEnter, setEnter] = useState<boolean>(false);
  const [code, setCode] = useState<string>('');
  const service = useContext(AFConfigContext)?.service;
  const handleSubmit = async () => {
    if (loading) return;
    if (!code) {
      setError(t('requireCode'));
      return;
    }

    setLoading(true);
    console.log('[CheckEmail] Starting OTP verification', { email, code: code.substring(0, 3) + '***' });

    try {
      console.log('[CheckEmail] Calling service.signInOTP');
      await service?.signInOTP({
        email,
        redirectTo,
        code,
        ...(otpType ? { type: otpType } : {}),
      });
      console.log('[CheckEmail] signInOTP completed successfully');
      // eslint-disable-next-line
    } catch (e: any) {
      console.error('[CheckEmail] signInOTP failed:', e);
      if (e.code === 403) {
        setError(t('invalidOTPCode'));
      } else {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={'flex text-text-primary flex-col gap-5 items-center justify-center w-full px-4'}>
      <div
        onClick={() => {
          window.location.href = '/';
        }}
        className={'flex cursor-pointer'}
      >
        <Logo className={'h-10 w-10'} />
      </div>
      <div className={'text-xl text-text-primary font-semibold'}>
        {isEnter ? t('enterCode') : t('checkYourEmail')}
      </div>
      <div className={'flex text-sm w-[320px] text-center items-center flex-col justify-center'}>
        <div className={'font-normal'}>{isEnter ? t('checkCodeTip') : t('checkEmailTip')}</div>
        <div className={'font-semibold'}>
          {email}
        </div>
      </div>
      {isEnter ? (
        <div className={'flex flex-col gap-3'}>
          <div className={'flex flex-col gap-1'}>
            <Input
              data-testid="otp-code-input"
              autoFocus
              size={'md'}
              className={'w-[320px]'}
              onChange={(e) => {
                setError('');
                setCode(e.target.value);
              }}
              value={code}
              placeholder={t('enterCode')}
              variant={error ? 'destructive' : 'default'}
              onKeyDown={e => {
                if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
                  void handleSubmit();
                }
              }}
            />
            {error && <div className={cn('help-text text-xs text-text-error')}>
              {error}
            </div>}
          </div>

          <Button
            data-testid="otp-submit-button"
            loading={loading}
            onClick={handleSubmit}
            size={'lg'}
            className={'w-[320px]'}
          >
            {loading ? <>
              <Progress />
              {t('verifying')}
            </> : t('continueToSignIn')}
          </Button>
        </div>
      ) : <Button
        data-testid="enter-code-manually-button"
        size={'lg'}
        className={'w-[320px]'}
        onClick={() => setEnter(true)}
      >
        {t('enterCodeManually')}
      </Button>}

      <Button
        variant={'link'}
        onClick={() => {
          window.location.href = `/login?redirectTo=${redirectTo}`;
        }}
        className={'w-[320px]'}
      >
        {t('backToLogin')}
      </Button>
    </div>
  );
}

export default CheckEmail;