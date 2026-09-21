import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DriveFile, DriveFiles, listDriveFiles } from '@/application/integrations/google-drive';
import { getConnectionEmail } from '@/application/services/domains/integration';
import { useConnections } from '@/components/app/settings/connections/useConnections';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getErrorMessage } from '@/utils/errors';

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
  const accounts = useMemo(
    () => connections.filter((connection) => connection.provider === 'google-drive'),
    [connections]
  );
  const [selectedId, setSelectedId] = useState('');
  const account = accounts.find((value) => value.id === selectedId) ?? accounts[0];
  const connectionId = account?.id;
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [retry, setRetry] = useState(0);
  const [files, setFiles] = useState<DriveFiles>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController>();

  useEffect(() => {
    const controller = new AbortController();

    void Promise.all(
      accounts.map(async (value) => {
        const email =
          value.account_identifier ||
          (await getConnectionEmail(workspaceId, value, controller.signal).catch(() => undefined));

        if (email && !controller.signal.aborted) setEmails((current) => ({ ...current, [value.id]: email }));
      })
    );
    return () => controller.abort();
  }, [accounts, workspaceId]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 300);

    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    request.current?.abort();
    setFiles({});
    setError('');
    setBusy(false);
    if (!connectionId) return;
    const controller = new AbortController();

    request.current = controller;
    setBusy(true);
    void listDriveFiles(workspaceId, connectionId, query, undefined, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setFiles(result);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(getErrorMessage(failure, t('document.plugins.googleDrive.loadFailed')));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [connectionId, query, workspaceId, t, retry]);

  const loadMore = async () => {
    if (!connectionId || !files.nextPageToken || busy) return;
    const controller = new AbortController();

    request.current?.abort();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const result = await listDriveFiles(workspaceId, connectionId, query, files.nextPageToken, controller.signal);

      if (!controller.signal.aborted)
        setFiles((current) => ({ ...result, files: [...(current.files ?? []), ...(result.files ?? [])] }));
    } catch (failure) {
      if (!controller.signal.aborted) setError(getErrorMessage(failure, t('document.plugins.googleDrive.loadFailed')));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  useEffect(() => () => request.current?.abort(), []);

  return (
    <div className='flex min-w-0 flex-col gap-3' data-testid='google-drive-browser'>
      {loading && <p role='status'>{t('settings.connections.loading')}</p>}
      {(loadError || connectionError || error) && (
        <p role='alert' className='text-sm text-text-error'>
          {loadError || connectionError || error}
        </p>
      )}
      {loadError && (
        <Button variant='outline' onClick={() => void reload()}>
          {t('settings.connections.retry')}
        </Button>
      )}
      {error && (
        <Button variant='outline' onClick={() => setRetry((current) => current + 1)}>
          {t('settings.connections.retry')}
        </Button>
      )}
      {accounts.length > 0 && (
        <>
          <select
            aria-label={t('document.plugins.googleDrive.account')}
            value={connectionId}
            onChange={(event) => setSelectedId(event.target.value)}
            className='rounded border border-border-primary bg-background-primary p-2 text-sm'
          >
            {accounts.map((value, index) => (
              <option key={value.id} value={value.id}>
                {emails[value.id] || value.account_identifier || `${t('settings.connections.googleDrive')} ${index + 1}`}
              </option>
            ))}
          </select>
          <Input
            aria-label={t('document.plugins.googleDrive.search')}
            placeholder={t('document.plugins.googleDrive.search')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className='max-h-64 overflow-y-auto' aria-busy={busy}>
            {(files.files ?? [])
              .filter((file) => !file.trashed)
              .map((file) => (
                <button
                  key={file.id}
                  type='button'
                  className='block w-full truncate rounded p-2 text-left text-sm hover:bg-fill-list-hover'
                  onClick={() => onSelect(file, emails[connectionId] || account?.account_identifier)}
                >
                  {file.name}
                </button>
              ))}
            {busy && (
              <p role='status' className='p-2 text-sm'>
                {t('settings.connections.loading')}
              </p>
            )}
            {!busy && !error && files.files?.length === 0 && (
              <p className='p-2 text-sm text-text-secondary'>{t('document.plugins.googleDrive.noFiles')}</p>
            )}
          </div>
          {files.nextPageToken && (
            <Button variant='outline' disabled={busy} onClick={() => void loadMore()}>
              {t('document.plugins.googleDrive.loadMore')}
            </Button>
          )}
        </>
      )}
      {pending ? (
        <div role='status' className='text-sm'>
          {t(`settings.connections.${pending.stage}`)}
          <Button variant='ghost' onClick={cancel}>
            {t('button.cancel')}
          </Button>
        </div>
      ) : (
        <Button
          variant='outline'
          disabled={loading || !!loadError || !configuredProviders.includes('google-drive')}
          onClick={() => void connect('google-drive')}
        >
          {t(
            accounts.length
              ? 'settings.connections.connectAnotherAccount'
              : 'document.plugins.googleDrive.connectGoogleAccount'
          )}
        </Button>
      )}
    </div>
  );
}
