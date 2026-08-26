import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { ReactComponent as Logo } from '@/assets/icons/logo.svg';
import { AuthService } from '@/application/services/domains';
import { buildLoginUrl } from '@/application/session/sign_in';
import { LOGIN_ACTION } from '@/components/login/const';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

export function ForgotPassword({ redirectTo, email: initialEmail }: { redirectTo: string; email: string }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState(initialEmail);
  const [, setSearch] = useSearchParams();
  const submittingRef = useRef(false);
  const handleSubmit = async (e: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (submittingRef.current) return;

    submittingRef.current = true;
    setLoading(true);

    try {
      await AuthService.forgotPassword({ email });
      setSearch((prev) => {
        const next = new URLSearchParams(prev);

        next.set('email', email);
        next.set('action', LOGIN_ACTION.CHECK_EMAIL_RESET_PASSWORD);
        return next;
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      if (e.code === 429 || e.response?.status === 429) {
        toast.error(t('tooManyRequests'));
      } else {
        toast.error(e.message);
      }
    } finally {
      submittingRef.current = false;
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
      <div className={'text-xl font-semibold text-text-primary'}>{t('resetPassword.title')}</div>
      <div className={'flex w-full items-center justify-center gap-1.5 text-center text-sm'}>
        {t('resetPassword.description')}
      </div>
      <div className={'flex w-full flex-col gap-2'}>
        <div className={'flex flex-col gap-1'}>
          <Input
            autoFocus
            size={'md'}
            className={'w-full'}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            value={email}
            placeholder={t('resetPassword.placeholder')}
            type='email'
            disabled={loading}
            onKeyDown={(e) => {
              if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
                void handleSubmit(e);
              }
            }}
          />
        </div>
      </div>
      <Button
        data-testid='forgot-password-submit-button'
        loading={loading}
        size={'lg'}
        className={'w-full'}
        onClick={handleSubmit}
      >
        {loading && <Progress />}
        {t('resetPassword.submit')}
      </Button>
      <Button
        variant={'link'}
        onClick={() => {
          window.location.href = buildLoginUrl({ redirectTo });
        }}
        disabled={loading}
        className={'w-full'}
      >
        {t('backToLogin')}
      </Button>
    </div>
  );
}
