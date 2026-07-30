import { useCallback, useMemo, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { NormalModal } from '@/components/_shared/modal';
import { MODAL_CLASSES } from '@/components/app/workspaces/modal-props';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';

const PAPER_PROPS = { sx: { width: 420 } } as const;

const TITLE_ID = 'ldap-login-title';
const DESCRIPTION_ID = 'ldap-login-description';
// Both fields point at the same message, so the id is shared.
const ERROR_ID = 'ldap-login-error';

interface LdapLoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (username: string, password: string) => Promise<void>;
}

/**
 * Credential prompt for a configured LDAP directory.
 *
 * The connection's user filter decides whether the login is a directory uid,
 * an email address, or another directory attribute. The server also rejects a
 * bad password, an unknown user and a user whose entry lacks the mail attribute
 * with one identical message, so this shows whatever it returns rather than
 * guessing at a reason.
 */
function LdapLoginDialog({ open, onOpenChange, onSubmit }: LdapLoginDialogProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setUsername('');
    setPassword('');
    setError(null);
    setLoading(false);
  }, []);

  // Cleared once the close transition has finished rather than on open: the
  // password must not sit in component state after the dialog is dismissed,
  // and waiting for `onExited` keeps the form from blanking mid-animation.
  const transitionProps = useMemo(() => ({ onExited: reset }), [reset]);

  const handleClose = useCallback(() => {
    if (loading) return;

    onOpenChange(false);
  }, [loading, onOpenChange]);

  const isFormValid = Boolean(username.trim() && password);

  const handleSubmit = useCallback(async () => {
    // NormalModal fires `onOk` on Enter regardless of the button's disabled
    // state, so the guard has to live here rather than on the button alone.
    if (loading) return;

    if (!isFormValid) {
      setError(t('web.ldapCredentialsRequired'));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await onSubmit(username.trim(), password);
      // Success navigates away. `loading` is deliberately left set so the form
      // stays disabled for the unload window, otherwise a second Enter fires
      // another sign-in against a dialog that is already on its way out.
    } catch (e: unknown) {
      const err = e as { message?: string };

      setError(err?.message || t('web.signInError'));
      // Only the password is cleared: a failed attempt is usually a typo, and
      // retyping the username every time is pure friction.
      setPassword('');
      setLoading(false);
    }
  }, [loading, isFormValid, username, password, onSubmit, t]);

  const handleOk = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  const handleUsernameChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setUsername(e.target.value);
    setError(null);
  }, []);

  const handlePasswordChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    setError(null);
  }, []);

  const title = useMemo(
    () => (
      <div id={TITLE_ID} className='text-left'>
        {t('web.ldapLogin')}
      </div>
    ),
    [t]
  );

  return (
    <NormalModal
      open={open}
      aria-labelledby={TITLE_ID}
      aria-describedby={DESCRIPTION_ID}
      onClose={handleClose}
      onOk={handleOk}
      closable={!loading}
      okText={t('web.continue')}
      okLoading={loading}
      okButtonProps={{ disabled: !isFormValid || loading }}
      cancelButtonProps={{ disabled: loading }}
      title={title}
      classes={MODAL_CLASSES}
      PaperProps={PAPER_PROPS}
      TransitionProps={transitionProps}
    >
      <div
        data-testid='ldap-login-dialog'
        className='flex w-full flex-col gap-4'
      >
        <div id={DESCRIPTION_ID} className='help-text text-xs text-text-caption'>
          {t('web.ldapLoginDescription')}
        </div>

        <div className='flex flex-col gap-1'>
          <Label htmlFor='ldap-username'>{t('web.ldapUsernamePlaceholder')}</Label>
          <Input
            id='ldap-username'
            autoFocus
            size='md'
            className='w-full'
            autoComplete='username'
            value={username}
            variant={error ? 'destructive' : 'default'}
            aria-invalid={!!error}
            aria-describedby={error ? ERROR_ID : undefined}
            disabled={loading}
            onChange={handleUsernameChange}
          />
        </div>

        <div className='flex flex-col gap-1'>
          <Label htmlFor='ldap-password'>{t('web.ldapPasswordPlaceholder')}</Label>
          <PasswordInput
            id='ldap-password'
            size='md'
            className='w-full'
            autoComplete='current-password'
            value={password}
            variant={error ? 'destructive' : 'default'}
            aria-invalid={!!error}
            aria-describedby={error ? ERROR_ID : undefined}
            disabled={loading}
            onChange={handlePasswordChange}
          />
        </div>

        {error && (
          <div
            id={ERROR_ID}
            className='help-text text-xs text-text-error'
            role='alert'
          >
            {error}
          </div>
        )}
      </div>
    </NormalModal>
  );
}

export default LdapLoginDialog;
