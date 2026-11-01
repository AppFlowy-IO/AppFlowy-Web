import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { MCP_SCOPES, type McpScope } from '@/application/mcp/setup';
import { cn } from '@/lib/utils';

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
            className={cn(
              'flex items-start gap-3 rounded-300 px-1 py-1.5',
              locked || disabled ? 'cursor-default' : 'cursor-pointer'
            )}
          >
            <input
              type='checkbox'
              checked={locked || scopes.includes(scope)}
              disabled={locked}
              onChange={(event) => onToggle(scope, event.target.checked)}
              aria-describedby={descriptionId}
              className='mt-0.5 h-4 w-4 shrink-0 accent-fill-theme-thick'
              data-testid={`mcp-consent-scope-${scope}`}
            />
            <span className='flex min-w-0 flex-col'>
              <span className='text-sm text-text-primary'>{t(SCOPE_TEXT[scope].title)}</span>
              <span id={descriptionId} className='text-xs text-text-secondary'>
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
