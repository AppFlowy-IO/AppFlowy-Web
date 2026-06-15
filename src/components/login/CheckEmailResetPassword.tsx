import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { AuthService } from '@/application/services/domains';
import { ReactComponent as Logo } from '@/assets/icons/logo.svg';
import { LOGIN_ACTION } from '@/components/login/const';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

function CheckEmailResetPassword({ email, redirectTo }: { email: string; redirectTo: string }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string>('');
  const [isEnter, setEnter] = useState<boolean>(false);
  const [code, setCode] = useState<string>('');
  const handleSubmit = async () => {
    if (loading) return;
    if (!code) {
      setError(t('requireCode'));
      return;
    }

    setLoading(true);

    try {
      await AuthService.signInOTP({
        email,
        code,
        type: 'recovery',
        redirectTo: encodeURIComponent(
          `${window.location.origin}/login?action=${LOGIN_ACTION.CHANGE_PASSWORD}&email=${email}&redirectTo=${redirectTo}`
        ),
      });

      // eslint-disable-next-line
    } catch (e: any) {
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
    <div className={'flex w-[320px] flex-col items-center justify-center gap-5 text-text-primary'}>
      <div
        onClick={() => {
          window.location.href = '/';
        }}
        className={'flex cursor-pointer'}
      >
        <Logo className={'h-10 w-10'} />
      </div>
      <div className={'text-center text-xl font-semibold text-text-primary'}>
        {isEnter ? t('resetPassword.enterCode') : t('resetPassword.checkYourEmail')}
      </div>
      <div className={'w-full text-center text-sm font-normal'}>
        <Trans
          i18nKey={isEnter ? 'resetPassword.checkCodeTip' : 'resetPassword.checkEmailTip'}
          components={{ email: <span className={'whitespace-nowrap font-semibold'}>{email}</span> }}
        />
      </div>
      {isEnter ? (
        <div className={'flex w-full flex-col gap-3'}>
          <div className={'flex w-full flex-col gap-1'}>
            <Input
              autoFocus
              size={'md'}
              className={'w-full'}
              onChange={(e) => {
                setError('');
                setCode(e.target.value);
              }}
              value={code}
              placeholder={t('resetPassword.enterCode')}
              variant={error ? 'destructive' : 'default'}
              onKeyDown={(e) => {
                if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
                  void handleSubmit();
                }
              }}
            />
            {error && <div className={cn('help-text text-xs text-text-error')}>{error}</div>}
          </div>

          <Button loading={loading} onClick={handleSubmit} size={'lg'} className={'w-full'}>
            {loading ? (
              <>
                <Progress />
                {t('verifying')}
              </>
            ) : (
              t('resetPassword.continue')
            )}
          </Button>
        </div>
      ) : (
        <Button size={'lg'} className={'w-full'} onClick={() => setEnter(true)}>
          {t('enterCodeManually')}
        </Button>
      )}

      <Button
        variant={'link'}
        onClick={() => {
          window.location.href = `/login?redirectTo=${redirectTo}`;
        }}
        className={'w-full'}
      >
        {t('backToLogin')}
      </Button>
    </div>
  );
}

export default CheckEmailResetPassword;
