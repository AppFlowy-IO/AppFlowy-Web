import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { McpConnectedApp } from '@/application/mcp/setupApps';
import { ReactComponent as TickIcon } from '@/assets/icons/tick.svg';

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
              className='inline-flex min-w-0 max-w-full items-center gap-1 rounded-200 bg-surface-container-layer-02 px-1 py-px text-sm text-text-primary'
              data-testid='mcp-setup-connected-app'
              data-app={app.setupApp}
            >
              <TickIcon aria-hidden='true' className='h-5 w-5 shrink-0 text-icon-success-thick' />
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
