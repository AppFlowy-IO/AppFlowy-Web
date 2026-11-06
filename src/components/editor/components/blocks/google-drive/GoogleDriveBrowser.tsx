import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DriveFile } from '@/application/integrations/google-drive';
import { getConnectionEmail } from '@/application/services/domains/integration';
import { useConnections } from '@/components/app/settings/connections/useConnections';
import { Button } from '@/components/ui/button';

import { DriveIcon as ThemedDriveIcon } from './DriveMenuItems';
import { GoogleDrivePicker } from './GoogleDrivePicker';

export function GoogleDriveBrowser({
  workspaceId,
  onSelect,
}: {
  workspaceId: string;
  onSelect: (file: DriveFile, email?: string) => void;
}) {
  const { t } = useTranslation();
  const { connections, configuredProviders, loading, pending, loadError, connectionError, connect, cancel, reload } =
    useConnections(workspaceId);
  const accounts = useMemo(() => connections.filter((value) => value.provider === 'google-drive'), [connections]);
  const [selectedId, setSelectedId] = useState('');
  const [emails, setEmails] = useState<Record<string, string>>({});
  const beforeConnect = useRef<Set<string>>();
  const selected = accounts.find((value) => value.id === selectedId);
  const accountButtons = useRef(new Map<string, HTMLButtonElement>());
  const closePicker = () => {
    setSelectedId('');
    accountButtons.current.get(selectedId)?.focus();
  };

  useEffect(() => {
    const controller = new AbortController();

    void Promise.all(
      accounts.map(async (account) => {
        const email =
          account.account_identifier ||
          (await getConnectionEmail(workspaceId, account, controller.signal).catch(() => undefined));

        if (email && !controller.signal.aborted) setEmails((current) => ({ ...current, [account.id]: email }));
      })
    );
    return () => controller.abort();
  }, [accounts, workspaceId]);

  useEffect(() => {
    if (!beforeConnect.current || loading || pending) return;
    const added = accounts.find((account) => !beforeConnect.current?.has(account.id));

    if (added) setSelectedId(added.id);
    beforeConnect.current = undefined;
  }, [accounts, loading, pending]);

  const connectAccount = () => {
    beforeConnect.current = new Set(accounts.map((account) => account.id));
    void connect('google-drive');
  };

  const error = loadError || connectionError;
  const disabled = loading || !!loadError || !configuredProviders.includes('google-drive');
  const providerUnavailable = !loading && !loadError && !configuredProviders.includes('google-drive');

  return (
    <div data-testid='google-drive-browser'>
      {loading && (
        <p role='status' className='p-5 text-text-secondary'>
          {t('settings.connections.loading')}
        </p>
      )}
      {error && (
        <div className='p-5'>
          <p role='alert' className='text-text-error'>
            {error}
          </p>
          {loadError && (
            <Button variant='outline' onClick={() => void reload()}>
              {t('settings.connections.retry')}
            </Button>
          )}
        </div>
      )}
      {providerUnavailable && (
        <div role='status' className='flex flex-col gap-2 px-5 pt-5 text-text-secondary'>
          <p>{t('settings.connections.providersUnavailable', { providers: t('settings.connections.googleDrive') })}</p>
          <Button variant='outline' className='h-8 self-start' onClick={() => void reload()}>
            {t('settings.connections.refresh')}
          </Button>
        </div>
      )}
      {pending ? (
        <div role='status' className='p-5'>
          {t(`settings.connections.${pending.stage}`)}
          <Button variant='ghost' onClick={cancel}>
            {t('button.cancel')}
          </Button>
        </div>
      ) : accounts.length ? (
        <>
          <div className='max-h-[184px] overflow-y-auto p-3 pb-0'>
            {accounts.map((account, index) => (
              <Button
                key={account.id}
                ref={(button) => {
                  if (button) accountButtons.current.set(account.id, button);
                  else accountButtons.current.delete(account.id);
                }}
                variant='ghost'
                className='h-8 w-full justify-start gap-2 rounded-lg px-2 text-sm font-normal'
                onClick={() => setSelectedId(account.id)}
              >
                <ThemedDriveIcon name='user' />
                <span className='truncate'>
                  {t('document.plugins.googleDrive.chooseFrom')}{' '}
                  <strong className='font-medium'>
                    {emails[account.id] ||
                      account.account_identifier ||
                      `${t('settings.connections.googleDrive')} ${index + 1}`}
                  </strong>
                </span>
              </Button>
            ))}
          </div>
          <div className='mt-3 border-t border-border-primary p-3'>
            <Button
              variant='ghost'
              className='h-8 w-full justify-start px-2 text-sm font-normal'
              disabled={disabled}
              onClick={connectAccount}
            >
              <ThemedDriveIcon name='plus' />
              {t('document.plugins.googleDrive.addAccount')}
            </Button>
          </div>
        </>
      ) : (
        !loading && (
          <div className='flex flex-col gap-4 p-5'>
            <Button className='h-8 w-full' disabled={disabled} onClick={connectAccount}>
              {t('document.plugins.googleDrive.connectGoogleAccount')}
            </Button>
            <p className='leading-5 text-text-secondary'>{t('document.plugins.googleDrive.findFiles')}</p>
          </div>
        )
      )}
      {selected && (
        <GoogleDrivePicker
          key={`${workspaceId}:${selected.id}`}
          workspaceId={workspaceId}
          connectionId={selected.id}
          onClose={closePicker}
          onSelect={(file) => {
            closePicker();
            onSelect(file, emails[selected.id] || selected.account_identifier);
          }}
        />
      )}
    </div>
  );
}
