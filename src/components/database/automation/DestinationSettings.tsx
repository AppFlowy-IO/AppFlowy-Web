import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { v4 as uuid } from 'uuid';

import { ERROR_CODE } from '@/application/constants';
import { notifyConnectionsChanged } from '@/application/integrations/connection-events';
import { authorizeIntegration } from '@/application/integrations/oauth';
import { ruleApi } from '@/application/services/js-services/http/automation-api';
import { confirmConnection } from '@/application/services/js-services/http/integration-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getAPIErrorCode } from '@/utils/errors';

export function ConnectAccount({
  workspace,
  connected,
  provider = 'slack',
}: {
  workspace: string;
  connected: (id: string) => void;
  provider?: 'slack' | 'gmail';
}) {
  const { t } = useTranslation();
  const onConnected = useRef(connected);

  onConnected.current = connected;
  const active = useRef<AbortController>();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => () => active.current?.abort(), [workspace, provider]);
  async function connect() {
    if (active.current) return;
    const ac = new AbortController();

    active.current = ac;
    setConnecting(true);
    setError(false);
    try {
      const { connectionId, oauthQuery } = await authorizeIntegration(workspace, provider, ac.signal);
      const result = await confirmConnection(workspace, provider, connectionId, oauthQuery, ac.signal);

      if (!result.success) throw Error();
      if (!ac.signal.aborted) {
        notifyConnectionsChanged(workspace);
        onConnected.current(connectionId);
      }
    } catch {
      if (!ac.signal.aborted) setError(true);
    } finally {
      if (!ac.signal.aborted) setConnecting(false);
      active.current = undefined;
    }
  }

  return (
    <div>
      <Button variant='ghost' type='button' disabled={connecting} onClick={() => void connect()}>
        {t(provider === 'slack' ? 'databaseAutomation.connectSlack' : 'databaseAutomation.connectGmail')}
      </Button>
      {error && <p role='alert'>{t('databaseAutomation.loadError')}</p>}
    </div>
  );
}

export function EndpointControls({
  workspace,
  selected,
  allowHeaders,
  receipts,
  selectedEndpoint,
  refresh,
  onChange,
}: {
  workspace: string;
  selected?: string;
  allowHeaders: boolean;
  receipts: boolean;
  selectedEndpoint?: { id: string; key_version?: number };
  refresh: () => void;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [pending, setOperation] = useState<
    { kind: 'new' } | { kind: 'rotate'; id: string; version?: number } | { kind: 'remove'; id: string }
  >();
  const operation = pending?.kind;
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<'saveError' | 'checkEndpointAfterError'>();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const mounted = useRef(false);
  const onChanged = useRef(onChange);
  const currentSelected = useRef(selected);
  const createRequest = useRef<string>();

  onChanged.current = onChange;
  currentSelected.current = selected;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [headers, setHeaders] = useState<{ id: number; name: string; value: string }[]>([]);
  const nextHeaderId = useRef(0);
  const validHeaders =
    headers.every(
      ({ name, value }) =>
        /^[a-zA-Z0-9!#$%&'*+.^_|~`-]{1,128}$/.test(name) &&
        Array.from(value).every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127) &&
        new Blob([value]).size <= 2048
    ) && new Set(headers.map((h) => h.name.toLowerCase())).size === headers.length;

  function clearRegistration() {
    createRequest.current = undefined;
    setName('');
    setUrl('');
    setHeaders([]);
  }

  async function submit() {
    if (running.current) return;
    const retryingCreate = createRequest.current !== undefined;

    running.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (operation === 'new') {
        const headerValues =
          allowHeaders && headers.length ? Object.fromEntries(headers.map((h) => [h.name, h.value])) : undefined;
        const requestId = receipts ? (createRequest.current ??= uuid()) : undefined;
        const result = await ruleApi.createWebhook(workspace, name, url, headerValues, requestId);

        if (!mounted.current) return;
        setSecret(result.signing_secret);
        if (currentSelected.current === selected) onChanged.current(result.endpoint.id);
        else refresh();
      } else if (pending?.kind === 'rotate' && pending.id === selected) {
        const result = await ruleApi.rotateWebhook(workspace, pending.id, pending.version);

        if (!mounted.current) return;

        setSecret(result.signing_secret);
        refresh();
      } else if (pending?.kind === 'remove' && pending.id === selected) {
        await ruleApi.removeWebhook(workspace, pending.id);
        if (!mounted.current) return;
        if (currentSelected.current === selected) onChanged.current('');
        else refresh();
      }

      clearRegistration();
      setOperation(undefined);
    } catch (cause) {
      if (!mounted.current) return;
      const code = getAPIErrorCode(cause);

      // Only a rejection of the first submission proves the endpoint was never registered.
      if (!retryingCreate && (code === 400 || code === ERROR_CODE.INVALID_REQUEST)) createRequest.current = undefined;

      // The server cannot return the creation secret once the endpoint was rotated or removed.
      const retiredReceipt = operation === 'new' && (code === ERROR_CODE.RECORD_ALREADY_EXISTS || code === 409);
      const reviewEndpoints = retiredReceipt || (!receipts && (operation === 'new' || operation === 'rotate'));

      if (retiredReceipt) clearRegistration();
      if (operation === 'rotate' || reviewEndpoints) {
        refresh();
        setOperation(undefined);
      }

      setError(reviewEndpoints ? 'checkEndpointAfterError' : 'saveError');
    } finally {
      setBusy(false);
      running.current = false;
    }
  }

  return (
    <div className='flex flex-col gap-2'>
      {secret && (
        <label>
          {t('databaseAutomation.signingSecret')}
          <Input readOnly value={secret} />
          <Button variant='ghost' type='button' onClick={() => setSecret('')}>
            {t('databaseAutomation.dismissSecret')}
          </Button>
        </label>
      )}
      {!operation ? (
        <div className='flex flex-wrap gap-2'>
          <Button
            type='button'
            variant='ghost'
            onClick={() => {
              setError(undefined);
              setOperation({ kind: 'new' });
            }}
          >
            {t('databaseAutomation.newEndpoint')}
          </Button>
          {selected && (
            <>
              <Button
                type='button'
                variant='ghost'
                disabled={!selectedEndpoint || (receipts && selectedEndpoint.key_version === undefined)}
                onClick={() => {
                  setError(undefined);
                  if (selectedEndpoint)
                    setOperation({
                      kind: 'rotate',
                      id: selectedEndpoint.id,
                      version: receipts ? selectedEndpoint.key_version : undefined,
                    });
                }}
              >
                {t('databaseAutomation.rotateEndpoint')}
              </Button>
              <Button
                type='button'
                variant='ghost'
                onClick={() => {
                  setError(undefined);
                  setOperation({ kind: 'remove', id: selected });
                }}
              >
                {t('databaseAutomation.removeEndpoint')}
              </Button>
            </>
          )}
        </div>
      ) : (
        <fieldset disabled={busy} className='flex flex-col gap-2'>
          {operation === 'new' ? (
            <fieldset className='flex flex-col gap-2' disabled={createRequest.current !== undefined}>
              <label>
                {t('databaseAutomation.name')}
                <Input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                {t('databaseAutomation.endpointUrl')}
                <Input type='url' autoComplete='off' value={url} onChange={(e) => setUrl(e.target.value)} />
              </label>
              {allowHeaders && (
                <>
                  {headers.map(({ id, name: field, value }) => (
                    <div key={id} className='flex flex-wrap gap-2'>
                      <Input
                        aria-label={t('databaseAutomation.headerName')}
                        maxLength={128}
                        value={field}
                        onChange={(e) =>
                          setHeaders((items) => items.map((h) => (h.id === id ? { ...h, name: e.target.value } : h)))
                        }
                      />
                      <Input
                        aria-label={t('databaseAutomation.headerValue')}
                        type='password'
                        autoComplete='new-password'
                        maxLength={2048}
                        value={value}
                        onChange={(e) =>
                          setHeaders((items) => items.map((h) => (h.id === id ? { ...h, value: e.target.value } : h)))
                        }
                      />
                      <Button
                        type='button'
                        variant='ghost'
                        onClick={() => setHeaders((items) => items.filter((h) => h.id !== id))}
                      >
                        {t('databaseAutomation.removeHeader')}
                      </Button>
                    </div>
                  ))}
                  <Button
                    type='button'
                    variant='outline'
                    disabled={headers.length >= 16}
                    onClick={() => setHeaders([...headers, { id: nextHeaderId.current++, name: '', value: '' }])}
                  >
                    {t('databaseAutomation.addHeader')}
                  </Button>
                </>
              )}
            </fieldset>
          ) : (
            <p>
              {t(
                operation === 'rotate' ? 'databaseAutomation.confirmRotate' : 'databaseAutomation.confirmRemoveEndpoint'
              )}
            </p>
          )}
          <div className='flex gap-2'>
            <Button
              type='button'
              disabled={
                pending?.kind === 'new'
                  ? !name.trim() || !url.startsWith('https://') || !validHeaders
                  : pending?.id !== selected
              }
              onClick={() => void submit()}
            >
              {t('databaseAutomation.confirm')}
            </Button>
            <Button
              type='button'
              variant='ghost'
              onClick={() => {
                clearRegistration();
                setOperation(undefined);
                setError(undefined);
              }}
            >
              {t('databaseAutomation.cancel')}
            </Button>
          </div>
        </fieldset>
      )}
      {error && <p role='alert'>{t(`databaseAutomation.${error}`)}</p>}
    </div>
  );
}
