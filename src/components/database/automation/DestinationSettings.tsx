import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authorizeIntegration } from '@/application/integrations/oauth';
import { ruleApi } from '@/application/services/js-services/http/automation-api';
import { confirmConnection } from '@/application/services/js-services/http/integration-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
  const active = useRef<AbortController>();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => () => active.current?.abort(), []);
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
      if (!ac.signal.aborted) connected(connectionId);
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
  onChange,
}: {
  workspace: string;
  selected?: string;
  allowHeaders: boolean;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [operation, setOperation] = useState<'new' | 'rotate' | 'remove'>();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [headers, setHeaders] = useState<{ id: number; name: string; value: string }[]>([]);
  const nextHeaderId = useRef(0);
  const validHeaders =
    headers.every(
      ({ name, value }) =>
        /^[a-zA-Z0-9!#$%&'*+.^_|~`-]{1,128}$/.test(name) &&
        Array.from(value).every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127) &&
        new Blob([value]).size <= 2048
    ) && new Set(headers.map((h) => h.name.toLowerCase())).size === headers.length;

  async function submit() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(false);
    try {
      if (operation === 'new') {
        const result =
          headers.length && allowHeaders
            ? await ruleApi.createWebhook(
                workspace,
                name,
                url,
                Object.fromEntries(headers.map((h) => [h.name, h.value]))
              )
            : await ruleApi.createWebhook(workspace, name, url);

        setSecret(result.signing_secret);
        onChange(result.endpoint.id);
      } else if (operation === 'rotate' && selected) {
        const result = await ruleApi.rotateWebhook(workspace, selected);

        setSecret(result.signing_secret);
      } else if (operation === 'remove' && selected) {
        await ruleApi.removeWebhook(workspace, selected);
        onChange('');
      }

      setName('');
      setUrl('');
      setHeaders([]);
      setOperation(undefined);
    } catch {
      setError(true);
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
              setError(false);
              setOperation('new');
            }}
          >
            {t('databaseAutomation.newEndpoint')}
          </Button>
          {selected && (
            <>
              <Button
                type='button'
                variant='ghost'
                onClick={() => {
                  setError(false);
                  setOperation('rotate');
                }}
              >
                {t('databaseAutomation.rotateEndpoint')}
              </Button>
              <Button
                type='button'
                variant='ghost'
                onClick={() => {
                  setError(false);
                  setOperation('remove');
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
            <>
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
            </>
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
              disabled={operation === 'new' && (!name.trim() || !url.startsWith('https://') || !validHeaders)}
              onClick={() => void submit()}
            >
              {t('databaseAutomation.confirm')}
            </Button>
            <Button
              type='button'
              variant='ghost'
              onClick={() => {
                setOperation(undefined);
                setUrl('');
                setHeaders([]);
                setError(false);
              }}
            >
              {t('databaseAutomation.cancel')}
            </Button>
          </div>
        </fieldset>
      )}
      {error && <p role='alert'>{t('databaseAutomation.saveError')}</p>}
    </div>
  );
}
