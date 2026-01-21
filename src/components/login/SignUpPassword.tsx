import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ReactComponent as Logo } from '@/assets/icons/logo.svg';
import { useService } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { getPasswordErrors } from '@/components/login/password-validation';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

export function SignUpPassword({ redirectTo }: { redirectTo: string }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const service = useService();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [error, setError] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);

  const validateEmail = useCallback((email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    return emailRegex.test(email);
  }, []);

  const getValidationErrors = useCallback(
    (password: string) => getPasswordErrors(password, t),
    [t]
  );

  const validateConfirmPassword = useCallback(
    (confirmPwd: string) => {
      if (confirmPwd !== password) {
        setError(t('changePassword.passwordErrorMatch'));
        return false;
      }

      setError('');
      return true;
    },
    [password, t]
  );

  const validateNewPassword = useCallback(
    (password: string) => {
      if (!password) {
        setPasswordErrors([]);
        return;
      }

      const errors = getValidationErrors(password);

      setPasswordErrors(errors);
    },
    [getValidationErrors]
  );

  const handleEmailChange = useCallback((value: string) => {
    setEmail(value);
    setEmailError('');
  }, []);

  const handlePasswordChange = useCallback((value: string) => {
    setPassword(value);
    setError('');
    setPasswordErrors([]);
  }, []);

  const handleSubmit = async (e: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (!service) return;

    // Validate email
    if (!email) {
      setEmailError(t('signIn.pleaseInputYourEmail'));
      return;
    }

    if (!validateEmail(email)) {
      setEmailError(t('signIn.invalidEmail'));
      return;
    }

    // Validate password
    const errors = getValidationErrors(password);

    if (errors.length > 0) {
      setPasswordErrors(errors);
      return;
    }

    if (password !== confirmPassword) {
      setError(t('changePassword.passwordErrorMatch'));
      return;
    }

    setLoading(true);
    setError('');
    setEmailError('');
    setPasswordErrors([]);

    try {
      await service.signUpWithPassword({ email, password, redirectTo });
      toast.success(t('signUp.signUpSuccess'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error.code === 422) {
        setEmailError(t('signUp.emailAlreadyRegistered'));
      } else if (error.code === 429) {
        toast.error(t('tooManyRequests'));
      } else {
        setError(error.message || t('signUp.signUpFailed'));
      }
    } finally {
      setLoading(false);
    }
  };

  const goBackToLogin = () => {
    const encodedRedirect = encodeURIComponent(redirectTo);

    window.location.href = `/login?redirectTo=${encodedRedirect}`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
      void handleSubmit(e);
    }
  };

  const hasPasswordErrors = passwordErrors.length > 0;
  const hasConfirmError = error?.includes('match');
  const hasEmailError = !!emailError;
  const isFormValid = email && password && confirmPassword && !hasPasswordErrors && !hasEmailError && password === confirmPassword;

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
      <div className={'text-xl font-semibold text-text-primary'}>{t('signUp.title')}</div>

      <div className={'flex w-full flex-col gap-3'}>
        <div className={'flex flex-col gap-1'}>
          <Label>{t('signUp.emailHint')}</Label>
          <Input
            autoFocus
            size={'md'}
            className={'w-full'}
            onChange={(e) => handleEmailChange(e.target.value)}
            value={email}
            placeholder={t('signIn.pleaseInputYourEmail')}
            variant={hasEmailError ? 'destructive' : 'default'}
            onKeyDown={handleKeyDown}
            data-testid="signup-email-input"
          />
          {hasEmailError && <div className={cn('help-text text-xs text-text-error')}>{emailError}</div>}
        </div>

        <div className={'flex flex-col gap-1'}>
          <Label>{t('signUp.passwordHint')}</Label>
          <PasswordInput
            size={'md'}
            className={'w-full'}
            onChange={(e) => handlePasswordChange(e.target.value)}
            onBlur={() => {
              validateNewPassword(password);
            }}
            value={password}
            placeholder={t('changePassword.placeholder')}
            variant={hasPasswordErrors ? 'destructive' : 'default'}
            onKeyDown={handleKeyDown}
            data-testid="signup-password-input"
          />
          {passwordErrors.length > 0 && (
            <div className={'flex flex-col gap-1'}>
              {passwordErrors.map((err, index) => (
                <div key={index} className={cn('help-text text-xs text-text-error')}>
                  {err}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={'flex flex-col gap-1'}>
          <Label>{t('signUp.repeatPasswordHint')}</Label>
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
            placeholder={t('signUp.repeatPasswordHint')}
            variant={hasConfirmError ? 'destructive' : 'default'}
            onKeyDown={handleKeyDown}
            data-testid="signup-confirm-password-input"
          />
          {hasConfirmError && <div className={cn('help-text text-xs text-text-error')}>{error}</div>}
        </div>

        {error && !hasConfirmError && <div className={cn('help-text text-xs text-text-error')}>{error}</div>}
      </div>

      <Button loading={loading} size={'lg'} className={'w-full'} onMouseDown={handleSubmit} disabled={!isFormValid} data-testid="signup-submit-button">
        {loading ? (
          <>
            <Progress />
            {t('verifying')}
          </>
        ) : (
          t('signUp.buttonText')
        )}
      </Button>

      <div className={'flex flex-col items-center gap-2 text-sm text-text-secondary'}>
        <div className={'flex items-center gap-1'}>
          <span>{t('signUp.alreadyHaveAnAccount')}</span>
          <Button
            variant={'link'}
            onClick={goBackToLogin}
            className={'px-0 text-text-secondary underline'}
            data-testid="signup-back-to-login-button"
          >
            {t('signIn.loginButtonText')}
          </Button>
        </div>
        <div className={'flex items-center gap-1'}>
          <span>{t('signUp.preferMagicLink')}</span>
          <Button
            variant={'link'}
            onClick={goBackToLogin}
            className={'px-0 text-text-secondary underline'}
            data-testid="signup-go-back-button"
          >
            {t('signUp.goBack')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default SignUpPassword;
