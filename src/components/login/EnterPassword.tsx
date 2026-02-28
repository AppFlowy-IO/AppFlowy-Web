import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { ReactComponent as Logo } from '@/assets/icons/logo.svg';
import { AuthService } from '@/application/services/domains';
import { LOGIN_ACTION } from '@/components/login/const';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

export function EnterPassword({ email, redirectTo }: { email: string; redirectTo: string }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await AuthService.signInWithPassword({ email, password, redirectTo });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      setError(error.message);
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
      <div className={'text-xl font-semibold text-text-primary'}>{t('signIn.enterPassword')}</div>
      <div className={'flex w-full items-center justify-center gap-1.5 text-center text-sm'}>
        <Trans
          i18nKey='signIn.enterPasswordTip'
          components={{ email: <span className={'font-semibold'}>{email}</span> }}
        />
      </div>
      <div className={'flex w-full flex-col gap-2'}>
        <div className={'flex flex-col gap-1'}>
          <PasswordInput
            data-testid="password-input"
            autoFocus
            size={'md'}
            className={'w-full'}
            onChange={(e) => {
              setError('');
              setPassword(e.target.value);
            }}
            value={password}
            placeholder={t('signIn.enterPassword')}
            variant={error ? 'destructive' : 'default'}
            onKeyDown={(e) => {
              if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
                void handleSubmit(e);
              }
            }}
          />
          {error && <div className={cn('help-text text-xs text-text-error')}>{error}</div>}
        </div>
        <Button
          variant={'link'}
          onClick={() => {
            window.location.href = `/login?action=${LOGIN_ACTION.RESET_PASSWORD}&email=${email}&redirectTo=${redirectTo}`;
          }}
          className={'w-full justify-start px-0 text-sm'}
        >
          {t('signIn.forgotPassword')}
        </Button>
      </div>
      <Button data-testid="password-submit-button" size={'lg'} className={'w-full'} onMouseDown={handleSubmit}>
        {loading ? (
          <>
            <Progress />
            {t('verifying')}
          </>
        ) : (
          t('signIn.continueToSignInWithPassword')
        )}
      </Button>
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
