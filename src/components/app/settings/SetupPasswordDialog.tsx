import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { readErrorIdentity } from '@/application/errors/error-message';
import { AuthService } from '@/application/services/domains';
import { NormalModal } from '@/components/_shared/modal';
import { HIDDEN_BUTTON_PROPS, MODAL_CLASSES } from '@/components/app/workspaces/modal-props';
import { getPasswordErrors } from '@/components/login/password-validation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import { getErrorMessage } from '@/utils/errors';

const PAPER_PROPS = { sx: { width: 420 } } as const;

// AppFlowy's GoTrue rejects a missing or wrong `current_password` with this
// reason once the user has chosen their own password.
const INCORRECT_CURRENT_PASSWORD = 'incorrect_current_password';

interface Props {
  open: boolean;
  onClose: () => void;
  // The user already chose a password, so GoTrue verifies the current one.
  requireCurrentPassword?: boolean;
  onSuccess?: () => void;
}

export function SetupPasswordDialog({ open, onClose, requireCurrentPassword = false, onSuccess }: Props) {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPasswordError, setCurrentPasswordError] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);
  const [confirmError, setConfirmError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [loading, setLoading] = useState(false);
  // Set when GoTrue asks for the current password although the panel's
  // auth-info said otherwise (stale or unavailable).
  const [serverRequiresCurrentPassword, setServerRequiresCurrentPassword] = useState(false);
  const needsCurrentPassword = requireCurrentPassword || serverRequiresCurrentPassword;

  const reset = useCallback(() => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setCurrentPasswordError('');
    setPasswordErrors([]);
    setConfirmError('');
    setSubmitError('');
    setLoading(false);
    setServerRequiresCurrentPassword(false);
  }, []);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(async () => {
    if (needsCurrentPassword && !currentPassword) {
      setCurrentPasswordError(t('settings.accountPage.password.currentPasswordRequired'));
      return;
    }

    const errors = getPasswordErrors(newPassword, t);

    if (errors.length > 0) {
      setPasswordErrors(errors);
      return;
    }

    if (newPassword !== confirmPassword) {
      setConfirmError(t('changePassword.passwordErrorMatch'));
      return;
    }

    setLoading(true);
    setSubmitError('');
    setCurrentPasswordError('');
    setConfirmError('');
    setPasswordErrors([]);

    try {
      await AuthService.changePassword({
        password: newPassword,
        currentPassword: needsCurrentPassword ? currentPassword : undefined,
      });
      toast.success(t('settings.accountPage.password.success'));
      onSuccess?.();
      handleClose();
    } catch (e) {
      if (readErrorIdentity(e).errorCode === INCORRECT_CURRENT_PASSWORD) {
        setCurrentPasswordError(
          needsCurrentPassword
            ? t('userError.CURRENT_PASSWORD_INCORRECT')
            : t('settings.accountPage.password.currentPasswordRequired')
        );
        setServerRequiresCurrentPassword(true);
      } else {
        setSubmitError(getErrorMessage(e, 'Failed to update password'));
      }
    } finally {
      setLoading(false);
    }
  }, [needsCurrentPassword, currentPassword, newPassword, confirmPassword, t, onSuccess, handleClose]);

  const hasCurrentPasswordError = Boolean(currentPasswordError);
  const hasPasswordErrors = passwordErrors.length > 0;
  const hasConfirmError = Boolean(confirmError);
  const isFormValid =
    (!needsCurrentPassword || currentPassword) &&
    newPassword &&
    confirmPassword &&
    !hasPasswordErrors &&
    newPassword === confirmPassword;
  const title = needsCurrentPassword
    ? t('settings.accountPage.password.changeButton')
    : t('settings.accountPage.password.setupButton');

  return (
    <NormalModal
      open={open}
      onClose={handleClose}
      title={<div style={{ textAlign: 'left' }}>{title}</div>}
      classes={MODAL_CLASSES}
      PaperProps={PAPER_PROPS}
      okButtonProps={HIDDEN_BUTTON_PROPS}
      cancelButtonProps={HIDDEN_BUTTON_PROPS}
    >
      <div
        data-testid='setup-password-dialog'
        className='flex w-full flex-col gap-4'
      >
        {needsCurrentPassword && (
          <div className='flex flex-col gap-1'>
            <Label htmlFor='setup-password-current'>{t('settings.accountPage.password.currentPassword')}</Label>
            <PasswordInput
              id='setup-password-current'
              autoFocus
              size='md'
              className='w-full'
              autoComplete='current-password'
              value={currentPassword}
              placeholder={t('settings.accountPage.password.currentPasswordPlaceholder')}
              variant={hasCurrentPasswordError ? 'destructive' : 'default'}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                setCurrentPasswordError('');
                setSubmitError('');
              }}
              onKeyDown={(e) => {
                if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
                  void handleSubmit();
                }
              }}
            />
            {hasCurrentPasswordError && (
              <div className={cn('help-text text-xs text-text-error')}>{currentPasswordError}</div>
            )}
          </div>
        )}

        <div className='flex flex-col gap-1'>
          <Label htmlFor='setup-password-new'>{t('changePassword.newPassword')}</Label>
          <PasswordInput
            id='setup-password-new'
            autoFocus={!needsCurrentPassword}
            size='md'
            className='w-full'
            autoComplete='new-password'
            value={newPassword}
            placeholder={t('changePassword.placeholder')}
            variant={hasPasswordErrors ? 'destructive' : 'default'}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setPasswordErrors([]);
              setSubmitError('');
            }}
            onBlur={() => {
              if (newPassword) setPasswordErrors(getPasswordErrors(newPassword, t));
            }}
            onKeyDown={(e) => {
              if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
                void handleSubmit();
              }
            }}
          />
          {hasPasswordErrors && (
            <div className='flex flex-col gap-1'>
              {passwordErrors.map((msg, i) => (
                <div key={i} className={cn('help-text text-xs text-text-error')}>
                  {msg}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className='flex flex-col gap-1'>
          <Label htmlFor='setup-password-confirm'>{t('changePassword.confirmPassword')}</Label>
          <PasswordInput
            id='setup-password-confirm'
            size='md'
            className='w-full'
            autoComplete='new-password'
            value={confirmPassword}
            placeholder={t('changePassword.confirmPassword')}
            variant={hasConfirmError ? 'destructive' : 'default'}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setConfirmError('');
            }}
            onKeyDown={(e) => {
              if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
                void handleSubmit();
              }
            }}
          />
          {hasConfirmError && <div className={cn('help-text text-xs text-text-error')}>{confirmError}</div>}
        </div>

        {submitError && (
          <div className={cn('help-text text-xs text-text-error')}>{submitError}</div>
        )}

        <Button
          loading={loading}
          size='default'
          className='w-full'
          disabled={!isFormValid || loading}
          onClick={() => void handleSubmit()}
          data-testid='setup-password-submit'
        >
          {loading ? (
            <>
              <Progress />
              {t('verifying')}
            </>
          ) : (
            title
          )}
        </Button>
      </div>
    </NormalModal>
  );
}

export default SetupPasswordDialog;
