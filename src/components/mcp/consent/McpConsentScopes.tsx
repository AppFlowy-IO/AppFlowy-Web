import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { MCP_SCOPES, type McpScope } from '@/application/mcp/setup';
import { ReactComponent as CheckIcon } from '@/assets/icons/check.svg';
import { cn } from '@/lib/utils';

import { CONSENT_CHECK_MARK, CONSENT_CHECKBOX, CONSENT_CHECKBOX_TARGET } from './McpConsentLayout';

const SCOPE_TEXT = {
  read: { title: 'mcp.consent.scopeReadTitle', description: 'mcp.consent.scopeReadDescription' },
  write: { title: 'mcp.consent.scopeWriteTitle', description: 'mcp.consent.scopeWriteDescription' },
  admin: { title: 'mcp.consent.scopeAdminTitle', description: 'mcp.consent.scopeAdminDescription' },
} as const;

export interface McpConsentScopesProps {
  /** Checked scopes; always includes `read`. */
  scopes: readonly McpScope[];
  onToggle: (scope: McpScope, checked: boolean) => void;
  disabled?: boolean;
}

/** What the app may do: read is always granted, write and admin can be turned off (or on). */
export function McpConsentScopes({ scopes, onToggle, disabled }: McpConsentScopesProps) {
  const { t } = useTranslation();
  const groupId = useId();

  return (
    <fieldset className='flex min-w-0 flex-col gap-1' disabled={disabled}>
      <legend className='mb-2 text-sm font-medium text-text-primary'>{t('mcp.consent.permissions')}</legend>
      {MCP_SCOPES.map((scope) => {
        const locked = scope === 'read';
        const descriptionId = `${groupId}-${scope}`;

        return (
          <label
            key={scope}
            className={cn('flex items-start gap-1 py-0.5', locked || disabled ? 'cursor-default' : 'cursor-pointer')}
          >
            <span className={CONSENT_CHECKBOX_TARGET}>
              <input
                type='checkbox'
                checked={locked || scopes.includes(scope)}
                disabled={locked}
                onChange={(event) => onToggle(scope, event.target.checked)}
                aria-describedby={descriptionId}
                className={CONSENT_CHECKBOX}
                data-testid={`mcp-consent-scope-${scope}`}
              />
              <CheckIcon aria-hidden='true' className={CONSENT_CHECK_MARK} />
            </span>
            <span className='flex min-w-0 flex-col'>
              <span className={cn('text-sm', disabled ? 'text-text-tertiary' : 'text-text-primary')}>
                {t(SCOPE_TEXT[scope].title)}
              </span>
              <span
                id={descriptionId}
                className={cn('text-xs leading-[18px]', disabled ? 'text-text-tertiary' : 'text-text-secondary')}
              >
                {t(SCOPE_TEXT[scope].description)}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export default McpConsentScopes;
