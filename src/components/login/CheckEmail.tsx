import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AuthService } from '@/application/services/domains';
import { buildLoginUrl } from '@/application/session/sign_in';
import { Log } from '@/utils/log';
import { ReactComponent as Logo } from '@/assets/icons/logo.svg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

function CheckEmail({ email, redirectTo, otpType }: { email: string; redirectTo: string; otpType?: 'signup' }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string>('');
  const [isEnter, setEnter] = useState<boolean>(false);
  const [code, setCode] = useState<string>('');
  const submittingRef = useRef(false);
  const handleSubmit = async () => {
    if (submittingRef.current) return;
    if (!code) {
      setError(t('requireCode'));
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    Log.info('[Auth] CheckEmail: starting OTP verification', { email });

    try {
      Log.info('[Auth] CheckEmail: calling signInOTP');
      await AuthService.signInOTP({
        email,
        redirectTo,
        code,
        ...(otpType ? { type: otpType } : {}),
      });
      Log.info('[Auth] CheckEmail: signInOTP completed successfully');
      // eslint-disable-next-line
    } catch (e: any) {
      Log.error('[Auth] CheckEmail: signInOTP failed', e);
      if (e.code === 403) {
        setError(t('invalidOTPCode'));
      } else {
        setError(e.message);
      }
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className={'flex w-full flex-col items-center justify-center gap-5 px-4 text-text-primary'}>
      <div
        onClick={() => {
          window.location.href = '/';
        }}
        className={'flex cursor-pointer'}
      >
        <Logo className={'h-10 w-10'} />
      </div>
      <div className={'text-xl font-semibold text-text-primary'}>{isEnter ? t('enterCode') : t('checkYourEmail')}</div>
      <div className={'flex w-[320px] flex-col items-center justify-center text-center text-sm'}>
        <div className={'font-normal'}>{isEnter ? t('checkCodeTip') : t('checkEmailTip')}</div>
        <div className={'font-semibold'}>{email}</div>
      </div>
      {isEnter ? (
        <div className={'flex flex-col gap-3'}>
          <div className={'flex flex-col gap-1'}>
            <Input
              data-testid='otp-code-input'
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
              disabled={loading}
              onKeyDown={(e) => {
                if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
                  void handleSubmit();
                }
              }}
            />
            {error && <div className={cn('help-text text-xs text-text-error')}>{error}</div>}
          </div>

          <Button
            data-testid='otp-submit-button'
            loading={loading}
            onClick={handleSubmit}
            size={'lg'}
            className={'w-[320px]'}
          >
            {loading ? (
              <>
                <Progress />
                {t('verifying')}
              </>
            ) : (
              t('continueToSignIn')
            )}
          </Button>
        </div>
      ) : (
        <Button
          data-testid='enter-code-manually-button'
          size={'lg'}
          className={'w-[320px]'}
          onClick={() => setEnter(true)}
        >
          {t('enterCodeManually')}
        </Button>
      )}

      <Button
        variant={'link'}
        onClick={() => {
          window.location.href = buildLoginUrl({ redirectTo });
        }}
        disabled={loading}
        className={'w-[320px]'}
      >
        {t('backToLogin')}
      </Button>
    </div>
  );
}

export default CheckEmail;
