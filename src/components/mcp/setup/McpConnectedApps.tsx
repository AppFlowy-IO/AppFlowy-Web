import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { McpConnectedApp } from '@/application/mcp/setupApps';
import { ReactComponent as CheckIcon } from '@/assets/icons/check.svg';

import { SETUP_APP_TEXT_KEYS } from './setupAppText';

/** "Connected apps (N)" with each app's name; nothing when there are none. */
export function McpConnectedApps({ apps }: { apps: readonly McpConnectedApp[] }) {
  const { t } = useTranslation();
  const labelId = useId();

  if (apps.length === 0) return null;

  return (
    <div className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2' data-testid='mcp-setup-connected-apps'>
      <span id={labelId} className='text-sm font-medium text-text-primary' data-testid='mcp-setup-connected-apps-label'>
        {t('mcp.setup.connectedApps', { count: apps.length })}
      </span>
      <ul aria-labelledby={labelId} className='flex min-w-0 flex-wrap items-center gap-1.5'>
        {apps.map((app) => {
          const name = app.setupApp
            ? t(`mcp.setup.${SETUP_APP_TEXT_KEYS[app.setupApp]}.name`)
            : app.name ?? t('mcp.setup.unknownApp');

          return (
            <li
              key={app.key}
              className='inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border-primary bg-fill-content px-2 py-0.5 text-xs text-text-primary'
              data-testid='mcp-setup-connected-app'
              data-app={app.setupApp}
            >
              <CheckIcon aria-hidden='true' className='h-3.5 w-3.5 shrink-0 text-icon-success-thick' />
              <span className='truncate' title={name}>
                {name}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
