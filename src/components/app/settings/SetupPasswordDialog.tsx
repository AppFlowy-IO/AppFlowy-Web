import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

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

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SetupPasswordDialog({ open, onClose }: Props) {
  const { t } = useTranslation();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);
  const [confirmError, setConfirmError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [loading, setLoading] = useState(false);

  const reset = useCallback(() => {
    setNewPassword('');
    setConfirmPassword('');
    setPasswordErrors([]);
    setConfirmError('');
    setSubmitError('');
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(async () => {
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
    setConfirmError('');
    setPasswordErrors([]);

    try {
      await AuthService.changePassword({ password: newPassword });
      toast.success(t('changePassword.success'));
      handleClose();
    } catch (e) {
      setSubmitError(getErrorMessage(e, 'Failed to update password'));
    } finally {
      setLoading(false);
    }
  }, [newPassword, confirmPassword, t, handleClose]);

  const hasPasswordErrors = passwordErrors.length > 0;
  const hasConfirmError = Boolean(confirmError);
  const isFormValid =
    newPassword && confirmPassword && !hasPasswordErrors && newPassword === confirmPassword;

  return (
    <NormalModal
      open={open}
      onClose={handleClose}
      title={<div style={{ textAlign: 'left' }}>{t('settings.accountPage.password.setupButton')}</div>}
      classes={MODAL_CLASSES}
      PaperProps={PAPER_PROPS}
      okButtonProps={HIDDEN_BUTTON_PROPS}
      cancelButtonProps={HIDDEN_BUTTON_PROPS}
    >
      <div
        data-testid='setup-password-dialog'
        className='flex w-full flex-col gap-4'
      >
        <div className='flex flex-col gap-1'>
          <Label htmlFor='setup-password-new'>{t('changePassword.newPassword')}</Label>
          <PasswordInput
            id='setup-password-new'
            autoFocus
            size='md'
            className='w-full'
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
            t('changePassword.submit')
          )}
        </Button>
      </div>
    </NormalModal>
  );
}

export default SetupPasswordDialog;
