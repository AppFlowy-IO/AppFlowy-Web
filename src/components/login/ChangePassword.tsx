import { useCallback, useContext, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { invalidToken } from '@/application/session/token';
import { ReactComponent as Logo } from '@/assets/icons/logo.svg';
import { AFConfigContext, useService } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { getPasswordErrors } from '@/components/login/password-validation';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

export function ChangePassword({ email, redirectTo }: { email: string; redirectTo: string }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const service = useService();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);

  const isAuthenticated = useContext(AFConfigContext)?.isAuthenticated || false;
  const [, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (!isAuthenticated) {
      setSearchParams((prev) => {
        prev.delete('email');
        prev.delete('action');
        prev.set('redirectTo', encodeURIComponent(redirectTo));
        return prev;
      });
    }
  }, [isAuthenticated, redirectTo, setSearchParams]);

  const getValidationErrors = useCallback(
    (password: string) => getPasswordErrors(password, t),
    [t]
  );

  const validateConfirmPassword = useCallback(
    (password: string) => {
      if (password !== newPassword) {
        setError(t('changePassword.passwordErrorMatch'));
        return false;
      }

      setError('');
      return true;
    },
    [newPassword, t]
  );

  const validateNewPassword = useCallback(
    (password: string) => {
      const errors = getValidationErrors(password);

      setPasswordErrors(errors);
    },
    [getValidationErrors]
  );

  const handlePasswordChange = useCallback((password: string) => {
    setNewPassword(password);
    setError('');
    setPasswordErrors([]);
  }, []);

  const handleSubmit = async (e: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (!service) return;

    const errors = getValidationErrors(newPassword);

    if (errors.length > 0) {
      setPasswordErrors(errors);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t('changePassword.passwordErrorMatch'));
      return;
    }

    setLoading(true);
    setError('');
    setPasswordErrors([]);

    try {
      await service.changePassword({ password: newPassword });
      toast.success(t('changePassword.success'));

      invalidToken();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const hasPasswordErrors = passwordErrors.length > 0;
  const hasConfirmError = error?.includes('match');
  const isFormValid = newPassword && confirmPassword && !hasPasswordErrors && newPassword === confirmPassword;

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
      <div className={'text-xl font-semibold text-text-primary'}>{t('changePassword.title')}</div>
      <div className={'w-full text-center text-sm font-normal'}>
        <Trans
          i18nKey='changePassword.description'
          components={{ email: <span className={'font-semibold'}>{email}</span> }}
        />
      </div>
      <div className={'flex w-full flex-col gap-3'}>
        <div className={'flex flex-col gap-1'}>
          <Label>{t('changePassword.newPassword')}</Label>
          <PasswordInput
            autoFocus
            size={'md'}
            className={'w-full'}
            onChange={(e) => {
              handlePasswordChange(e.target.value);
            }}
            onBlur={() => {
              validateNewPassword(newPassword);
            }}
            value={newPassword}
            placeholder={t('changePassword.placeholder')}
            variant={hasPasswordErrors ? 'destructive' : 'default'}
            onKeyDown={(e) => {
              if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
                void handleSubmit(e);
              }
            }}
          />
          {passwordErrors.length > 0 && (
            <div className={'flex flex-col gap-1'}>
              {passwordErrors.map((error, index) => (
                <div key={index} className={cn('help-text text-xs text-text-error')}>
                  {error}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={'flex flex-col gap-1'}>
          <Label>{t('changePassword.confirmPassword')}</Label>
          <PasswordInput
            size={'md'}
            className={'w-full'}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setError('');
            }}
            onBlur={() => {
              if (confirmPassword) {
                validateConfirmPassword(confirmPassword);
              }
            }}
            value={confirmPassword}
            placeholder={t('changePassword.confirmPassword')}
            variant={hasConfirmError ? 'destructive' : 'default'}
            onKeyDown={(e) => {
              if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
                void handleSubmit(e);
              }
            }}
          />
          {hasConfirmError && <div className={cn('help-text text-xs text-text-error')}>{error}</div>}
        </div>

        {error && !hasConfirmError && <div className={cn('help-text text-xs text-text-error')}>{error}</div>}
      </div>
      <Button loading={loading} size={'lg'} className={'w-full'} onMouseDown={handleSubmit} disabled={!isFormValid}>
        {loading ? (
          <>
            <Progress />
            {t('verifying')}
          </>
        ) : (
          t('changePassword.submit')
        )}
      </Button>
      <Button
        variant={'link'}
        onClick={() => {
          invalidToken();
        }}
        className={'w-full'}
      >
        {t('backToLogin')}
      </Button>
    </div>
  );
}
