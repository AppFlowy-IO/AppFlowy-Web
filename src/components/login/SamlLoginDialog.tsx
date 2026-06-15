import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

// Email validation regex - checks for valid email format
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const resetState = useCallback(() => {
    setEmail('');
    setError(null);
    setLoading(false);
  }, []);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      onOpenChange(newOpen);

      if (!newOpen) {
        resetState();
      }
    },
    [onOpenChange, resetState]
  );

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
    const validationError = validateEmail(email);

    if (validationError) {
      setError(validationError);
      return;
    }

    // Extract domain from email
    const domain = email.split('@')[1];

    setLoading(true);
    setError(null);

    try {
      await onSubmit(domain);
    } catch (e: unknown) {
      const err = e as { message?: string };

      setError(err?.message || t('web.signInError'));
    } finally {
      setLoading(false);
    }
  }, [email, validateEmail, onSubmit, t]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !loading) {
        void handleSubmit();
      }
    },
    [handleSubmit, loading]
  );

  const handleEmailChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    setError(null);
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('web.ssoLogin')}</DialogTitle>
          <DialogDescription id="saml-dialog-description">
            {t('web.ssoLoginDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-4">
          <Input
            type="email"
            placeholder={t('web.emailPlaceholder')}
            value={email}
            onChange={handleEmailChange}
            onKeyDown={handleKeyDown}
            disabled={loading}
            aria-label={t('web.emailPlaceholder')}
            aria-describedby="saml-dialog-description"
            aria-invalid={!!error}
            autoFocus
          />
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={loading}
          >
            {t('button.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !email.trim()}
          >
            {loading ? t('web.signingIn') : t('web.continueWithSso')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SamlLoginDialog;
