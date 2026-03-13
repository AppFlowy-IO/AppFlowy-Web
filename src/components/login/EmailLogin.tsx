import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import isEmail from 'validator/lib/isEmail';

import { AuthService } from '@/application/services/domains';
import { LOGIN_ACTION } from '@/components/login/const';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

function EmailLogin({ redirectTo }: { redirectTo: string }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [, setSearch] = useSearchParams();
  const handleSubmitEmail = async (e?: React.MouseEvent<HTMLButtonElement>) => {
    if (loading) return;
    const isValidEmail = isEmail(email);

    if (!isValidEmail) {
      e?.preventDefault();
      setError(t('signIn.invalidEmail'));
      return;
    }

    setError('');
    setLoading(true);

    void (async () => {
      try {
        await AuthService.signInMagicLink({
          email,
          redirectTo,
        });
        // eslint-disable-next-line
      } catch (e: any) {
        if (e.code === 429 || e.response?.status === 429) {
          toast.error(t('tooManyRequests'));
        } else {
          toast.error(e.message);
        }
      } finally {
        setLoading(false);
      }
    })();

    setSearch((prev) => {
      prev.set('email', email);
      prev.set('action', LOGIN_ACTION.CHECK_EMAIL);
      return prev;
    });
  };

  const handleSubmitPassword = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const isValidEmail = isEmail(email);

    if (!isValidEmail) {
      setError(t('signIn.invalidEmail'));
      return;
    }

    setSearch((prev) => {
      prev.set('email', email);
      prev.set('action', LOGIN_ACTION.ENTER_PASSWORD);
      return prev;
    });
  };

  return (
    <div className={'flex w-full flex-col items-center justify-center gap-3'}>
      <div className={'flex flex-col gap-1'}>
        <Input
          data-testid="login-email-input"
          autoFocus
          size={'md'}
          variant={error ? 'destructive' : 'default'}
          type={'email'}
          className={'w-[320px]'}
          onChange={(e) => {
            setError('');
            setEmail(e.target.value);
          }}
          value={email}
          placeholder={t('signIn.pleaseInputYourEmail')}
          onKeyDown={(e) => {
            if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
              void handleSubmitEmail();
            }
          }}
        />
        {error && <div className={cn('help-text text-xs text-text-error')}>{error}</div>}
      </div>

      <Button data-testid="login-magic-link-button" onMouseDown={handleSubmitEmail} size={'lg'} className={'w-[320px]'} loading={loading}>
        {loading ? (
          <>
            <Progress />
            {t('loading')}
          </>
        ) : (
          t('signIn.signInWithEmail')
        )}
      </Button>
      <Button data-testid="login-password-button" variant={'outline'} onMouseDown={handleSubmitPassword} size={'lg'} className={'w-[320px]'}>
        {t('signIn.signInWithPassword')}
      </Button>
    </div>
  );
}

export default EmailLogin;
