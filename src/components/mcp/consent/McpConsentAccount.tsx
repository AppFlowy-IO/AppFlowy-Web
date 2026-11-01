import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { CONSENT_FOCUS_RING } from './McpConsentLayout';

export interface McpConsentAccountProps {
  /** The signed-in user's email; omitted when unknown. */
  email?: string;
  /** Signs out and returns to sign-in with this consent request. */
  onSwitch: () => void;
  disabled?: boolean;
}

/** "Signed in as …" and "Use a different account". */
export function McpConsentAccount({ email, onSwitch, disabled }: McpConsentAccountProps) {
  const { t } = useTranslation();

  return (
    <div
      className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm'
      data-testid='mcp-consent-account'
    >
      {email && (
        <span className='min-w-0 truncate text-text-secondary' title={email} data-testid='mcp-consent-signed-in'>
          {t('mcp.consent.signedInAs', { email, interpolation: { escapeValue: false } })}
        </span>
      )}
      <Button
        variant='link'
        size='sm'
        className={cn('px-0', CONSENT_FOCUS_RING)}
        onClick={onSwitch}
        disabled={disabled}
        data-testid='mcp-consent-switch-account'
      >
        {t('mcp.consent.switchAccount')}
      </Button>
    </div>
  );
}

export default McpConsentAccount;
