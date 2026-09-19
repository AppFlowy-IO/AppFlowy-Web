import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  IntegrationConnection,
  IntegrationProvider,
  integrationProviders,
  isIntegrationProvider,
} from '@/application/integrations/types';
import * as IntegrationService from '@/application/services/domains/integration';
import { ReactComponent as GoogleCalendarIcon } from '@/assets/icons/google_calendar.svg';
import { ReactComponent as GoogleDriveIcon } from '@/assets/icons/google_drive.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { ConfirmModal } from '@/components/_shared/modal/ConfirmModal';
import { useConnections } from '@/components/app/settings/connections/useConnections';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';

const providers = {
  'google-drive': {
    Icon: GoogleDriveIcon,
    name: 'googleDrive',
    description: 'googleDriveDescription',
    access: 'canPreviewLinks',
  },
  'google-calendar': {
    Icon: GoogleCalendarIcon,
    name: 'googleCalendar',
    description: 'googleCalendarDescription',
    access: 'canSyncEvents',
  },
} as const;

export function ConnectionsPanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const {
    connections,
    configuredProviders,
    loading,
    loadError,
    connectionError,
    pending,
    disconnecting,
    reload,
    connect,
    cancel,
    disconnect,
  } = useConnections(workspaceId);
  const [disconnectTarget, setDisconnectTarget] = useState<{ connection: IntegrationConnection; email: string }>();
  // Keep Radix menus inside the MUI dialog's focus trap and stacking context.
  const [menuContainer, setMenuContainer] = useState<HTMLDivElement | null>(null);
  const busy = loading || Boolean(pending) || disconnecting;
  const connectDisabled = busy || Boolean(loadError);
  const unavailableProviders = integrationProviders.filter((provider) => !configuredProviders.includes(provider));

  return (
    <div
      className='flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
      data-testid='connections-panel'
      ref={setMenuContainer}
    >
      <div className='border-b border-border-primary px-8 py-5'>
        <h2 className='text-xl font-semibold text-text-primary'>{t('settings.connections.menuLabel')}</h2>
        <p className='mt-1 text-sm text-text-secondary'>{t('settings.connections.description')}</p>
      </div>
      <div className='appflowy-scroller flex-1 overflow-y-auto px-8 py-6'>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant='outline'
              disabled={connectDisabled || configuredProviders.length === 0}
              data-testid='add-connection'
            >
              <PlusIcon className='h-4 w-4' />
              {t('settings.connections.addConnection')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start' container={menuContainer}>
            {integrationProviders.map((provider) => (
              <DropdownMenuItem
                key={provider}
                onSelect={() => void connect(provider)}
                disabled={connectDisabled || !configuredProviders.includes(provider)}
              >
                <ProviderLabel provider={provider} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {!loading && !loadError && unavailableProviders.length > 0 && (
          <div
            role='status'
            className='mt-5 flex items-center justify-between gap-4 rounded-lg border border-border-primary p-4 text-sm'
          >
            <p className='text-text-secondary'>
              {t('settings.connections.providersUnavailable', {
                providers: unavailableProviders
                  .map((provider) => t(`settings.connections.${providers[provider].name}`))
                  .join(', '),
              })}
            </p>
            <Button variant='outline' onClick={() => void reload()} disabled={busy}>
              {t('settings.connections.refresh')}
            </Button>
          </div>
        )}

        {connectionError && (
          <div role='alert' className='mt-5 text-sm text-text-error'>
            {connectionError}
          </div>
        )}

        {loadError && (
          <div role='alert' className='mt-5 flex items-center justify-between gap-4 text-sm text-text-error'>
            <p>{loadError}</p>
            <Button variant='outline' onClick={() => void reload()} disabled={busy}>
              {t('settings.connections.retry')}
            </Button>
          </div>
        )}

        {pending && (
          <div role='status' className='mt-5 flex items-center gap-3 rounded-lg border border-border-primary p-4'>
            <Progress variant='primary' />
            <div className='min-w-0 flex-1'>
              <ProviderLabel provider={pending.provider} />
              <p className='mt-1 text-sm text-text-secondary'>
                {t(
                  pending.stage === 'authorizing'
                    ? 'settings.connections.authorizing'
                    : 'settings.connections.confirming'
                )}
              </p>
            </div>
            {pending.stage === 'authorizing' && (
              <Button variant='ghost' onClick={cancel}>
                {t('button.cancel')}
              </Button>
            )}
          </div>
        )}

        {loading && connections.length === 0 ? (
          <div role='status' aria-label={t('settings.connections.loading')} className='flex justify-center py-12'>
            <Progress variant='primary' />
          </div>
        ) : connections.length > 0 ? (
          <table className='mt-5 w-full table-fixed text-left text-sm'>
            <thead className='text-xs font-normal text-text-secondary'>
              <tr className='border-b border-border-primary'>
                <th className='w-[45%] py-3 font-normal'>{t('settings.connections.connection')}</th>
                <th className='py-3 font-normal'>{t('settings.connections.access')}</th>
                <th className='w-10'>
                  <span className='sr-only'>{t('settings.connections.manageConnection')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {connections.map((connection) => (
                <ConnectionRow
                  key={connection.id}
                  connection={connection}
                  workspaceId={workspaceId}
                  disabled={busy}
                  canConnect={!loadError && configuredProviders.some((provider) => provider === connection.provider)}
                  menuContainer={menuContainer}
                  onConnect={connect}
                  onDisconnect={(email) => setDisconnectTarget({ connection, email })}
                />
              ))}
            </tbody>
          </table>
        ) : (
          !loadError &&
          !pending && (
            <div className='mt-2 divide-y divide-border-primary'>
              {integrationProviders.map((provider) => (
                <div key={provider} className='flex items-center justify-between gap-4 py-5'>
                  <div className='min-w-0'>
                    <ProviderLabel provider={provider} />
                    <p className='mt-1 text-sm text-text-secondary'>
                      {t(`settings.connections.${providers[provider].description}`)}
                    </p>
                  </div>
                  <Button
                    variant='outline'
                    disabled={connectDisabled || !configuredProviders.includes(provider)}
                    onClick={() => void connect(provider)}
                    data-testid={`connect-${provider}`}
                  >
                    {t('settings.connections.connect')}
                  </Button>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      <ConfirmModal
        open={Boolean(disconnectTarget)}
        title={t('settings.connections.disconnectTitle', { account: disconnectTarget?.email })}
        description={t('settings.connections.disconnectDescription')}
        confirmText={t('settings.connections.disconnect')}
        loading={disconnecting}
        dialogTestId='disconnect-connection-dialog'
        confirmTestId='confirm-disconnect-connection'
        onClose={() => {
          if (!disconnecting) setDisconnectTarget(undefined);
        }}
        onConfirm={() => {
          if (disconnectTarget) {
            void disconnect(disconnectTarget.connection.id).then((success) => {
              if (success) setDisconnectTarget(undefined);
            });
          }
        }}
      />
    </div>
  );
}

function ProviderLabel({ provider }: { provider: IntegrationProvider }) {
  const { t } = useTranslation();
  const { Icon, name } = providers[provider];

  return (
    <span className='flex items-center gap-1.5 font-medium text-text-primary'>
      <Icon aria-hidden='true' className='h-5 w-5 shrink-0' />
      {t(`settings.connections.${name}`)}
    </span>
  );
}

function ConnectionRow({
  connection,
  workspaceId,
  disabled,
  canConnect,
  menuContainer,
  onConnect,
  onDisconnect,
}: {
  connection: IntegrationConnection;
  workspaceId: string;
  disabled: boolean;
  canConnect: boolean;
  menuContainer: HTMLDivElement | null;
  onConnect: (provider: IntegrationProvider) => Promise<void>;
  onDisconnect: (email: string) => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState<string>();
  const { id, provider } = connection;

  useEffect(() => {
    const controller = new AbortController();

    void IntegrationService.getConnectionEmail(workspaceId, { id, provider }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setEmail(result);
      })
      .catch(() => {
        /* The stored account identifier remains available if the provider is offline. */
      });
    return () => controller.abort();
  }, [id, provider, workspaceId]);

  if (!isIntegrationProvider(provider)) return null;
  const account = email || connection.account_identifier || t(`settings.connections.${providers[provider].name}`);

  return (
    <tr className='border-b border-border-primary' data-testid={`connection-${connection.id}`}>
      <td className='py-4 pr-4'>
        <ProviderLabel provider={provider} />
        <p className='mt-1 truncate text-xs text-text-secondary' title={account}>
          {account}
        </p>
      </td>
      <td className='py-4 pr-3 text-text-primary'>{t(`settings.connections.${providers[provider].access}`)}</td>
      <td>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              disabled={disabled}
              aria-label={t('settings.connections.manageAccount', { account })}
            >
              <MoreIcon className='h-5 w-5' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' container={menuContainer}>
            <DropdownMenuItem onSelect={() => void onConnect(provider)} disabled={disabled || !canConnect}>
              {t('settings.connections.connectAnotherAccount')}
            </DropdownMenuItem>
            <DropdownMenuItem variant='destructive' onSelect={() => onDisconnect(account)} disabled={disabled}>
              {t('settings.connections.disconnectAccount')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
