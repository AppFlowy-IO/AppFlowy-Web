import { useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { NormalModal } from '@/components/_shared/modal';
import { MODAL_CLASSES } from '@/components/app/workspaces/modal-props';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Email validation regex - checks for valid email format
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PAPER_PROPS = { sx: { width: 420 } } as const;

const TITLE_ID = 'saml-login-title';
const DESCRIPTION_ID = 'saml-login-description';
const ERROR_ID = 'saml-login-error';

interface SamlLoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (domain: string) => Promise<void>;
}

function SamlLoginDialog({ open, onOpenChange, onSubmit }: SamlLoginDialogProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const reset = useCallback(() => {
    setEmail('');
    setError(null);
    setLoading(false);
    submittingRef.current = false;
  }, []);

  // Cleared once the close transition has finished rather than on open, so a
  // dismissed dialog leaves nothing behind and the form is not visibly blanked
  // while it is still fading out.
  const transitionProps = useMemo(() => ({ onExited: reset }), [reset]);

  const handleClose = useCallback(() => {
    if (submittingRef.current) return;

    onOpenChange(false);
  }, [onOpenChange]);

  const validateEmail = useCallback(
    (emailValue: string): string | null => {
      if (!emailValue.trim()) {
        return t('web.emailRequired');
      }

      if (!EMAIL_REGEX.test(emailValue)) {
        return t('web.invalidEmail');
      }

      return null;
    },
    [t]
  );

  const handleSubmit = useCallback(async () => {
    // NormalModal fires `onOk` on Enter regardless of the button's disabled
    // state, so the guard has to live here rather than on the button alone.
    if (submittingRef.current) return;

    const validationError = validateEmail(email);

    if (validationError) {
      setError(validationError);
      return;
    }

    // Extract domain from email
    const domain = email.split('@')[1];

    submittingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      await onSubmit(domain);
      // Success redirects to the identity provider. `loading` is deliberately
      // left set so the form stays disabled for the unload window, otherwise a
      // second Enter starts another authorize round-trip.
    } catch (e: unknown) {
      const err = e as { message?: string };

      setError(err?.message || t('web.signInError'));
      submittingRef.current = false;
      setLoading(false);
    }
  }, [email, validateEmail, onSubmit, t]);

  const handleOk = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  const handleEmailChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    setError(null);
  }, []);

  const title = useMemo(
    () => (
      <div id={TITLE_ID} className='text-left'>
        {t('web.ssoLogin')}
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
      okText={t('web.continueWithSso')}
      okLoading={loading}
      okButtonProps={{ disabled: !email.trim() || loading }}
      cancelButtonProps={{ disabled: loading }}
      title={title}
      classes={MODAL_CLASSES}
      PaperProps={PAPER_PROPS}
      TransitionProps={transitionProps}
    >
      <div data-testid='saml-login-dialog' className='flex w-full flex-col gap-4'>
        <div id={DESCRIPTION_ID} className='help-text text-xs text-text-caption'>
          {t('web.ssoLoginDescription')}
        </div>

        <div className='flex flex-col gap-1'>
          <Label htmlFor='saml-email'>{t('signIn.emailHint')}</Label>
          <Input
            id='saml-email'
            type='email'
            autoFocus
            size='md'
            className='w-full'
            autoComplete='email'
            value={email}
            placeholder={t('web.emailPlaceholder')}
            variant={error ? 'destructive' : 'default'}
            aria-invalid={!!error}
            aria-describedby={error ? ERROR_ID : undefined}
            disabled={loading}
            onChange={handleEmailChange}
          />
        </div>

        {error && (
          <div id={ERROR_ID} className='help-text text-xs text-text-error' role='alert'>
            {error}
          </div>
        )}
      </div>
    </NormalModal>
  );
}

export default SamlLoginDialog;
