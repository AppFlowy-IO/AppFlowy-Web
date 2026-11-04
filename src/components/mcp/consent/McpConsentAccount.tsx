import { useTranslation } from 'react-i18next';

import { RAW_INTERPOLATION } from '@/components/mcp/rawInterpolation';
import { Button } from '@/components/ui/button';

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
    <div className='flex flex-col items-center text-center text-sm' data-testid='mcp-consent-account'>
      {email && (
        <span
          className='min-w-0 max-w-full truncate text-text-secondary'
          title={email}
          data-testid='mcp-consent-signed-in'
        >
          {t('mcp.consent.signedInAs', { email, ...RAW_INTERPOLATION })}
        </span>
      )}
      <Button
        variant='link'
        size='sm'
        className={CONSENT_FOCUS_RING}
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
