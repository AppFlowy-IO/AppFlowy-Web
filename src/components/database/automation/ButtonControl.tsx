import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { v4 as uuid } from 'uuid';

import { usePropertiesSelector } from '@/application/database-yjs';
import {
  ButtonBinding,
  ButtonConnector,
  ButtonInvocation,
  DatabaseRule,
  isRuleConflict,
  ruleApi,
} from '@/application/services/js-services/http/automation-api';
import { listConnections } from '@/application/services/js-services/http/integration-api';
import { isRecordNotFoundError } from '@/application/utils/error-utils';
import { Button } from '@/components/ui/button';

import { RuleForm } from './AutomationEditor';
import { Capabilities } from './model';
import { Item, Select } from './Select';

type Scope = { workspace: string; database: string; row: string; field: string; caps: Capabilities };
type Destinations = Partial<Record<ButtonConnector['kind'], Item[]>>;

async function destinations(workspace: string, binding: ButtonBinding, signal: AbortSignal) {
  const items: Destinations = {};
  const kinds = new Set(binding.connectors.map((c) => c.kind));

  if (kinds.has('gmail') || kinds.has('slack')) {
    for (const c of await listConnections(workspace, signal)) {
      if (c.status === 'active' && (c.provider === 'gmail' || c.provider === 'slack'))
        (items[c.provider] ??= []).push({ id: c.id, name: c.account_identifier || c.id });
    }
  }

  if (kinds.has('webhook')) {
    const ends: Item[] = [];
    const seen = new Set<string>();
    let next: string | undefined;

    do {
      const page = await ruleApi.webhooks(workspace, next, signal);

      ends.push(...page.items.filter((x) => !x.disabled));
      next = page.next_cursor;
      if (next && seen.has(next)) throw new Error('Invalid endpoint cursor');
      if (next) seen.add(next);
    } while (next && !signal.aborted);

    items.webhook = ends;
  }

  return items;
}

export function ButtonControl({ workspace, database, row, field, caps }: Scope) {
  const { t } = useTranslation();
  const { properties } = usePropertiesSelector(false);
  const [reload, setReload] = useState(0);
  const [binding, setBinding] = useState<ButtonBinding | null>();
  const [rules, setRules] = useState<DatabaseRule[]>();
  const [options, setOptions] = useState<Destinations>({});
  const [selected, setSelected] = useState<Record<number, string>>({});
  const [editor, setEditor] = useState<{ id: string; base?: DatabaseRule }>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [sendError, setSendError] = useState<'conflict' | 'saveError'>();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const pending = useRef<ButtonInvocation>();

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    const publish = <T,>(set: (v: T) => void, v: T) => {
      if (!signal.aborted) set(v);
    };

    setBinding(undefined);
    setRules(undefined);
    setLoadFailed(false);
    setSendError(undefined);
    setSelected({});
    setOptions({});
    setDone(false);
    pending.current = undefined;
    void ruleApi
      .list(workspace, database, signal, row)
      .then((v) => publish(setRules, v.items))
      .catch(() => {
        // A member may run the shared binding without being able to configure the row.
        publish(setRules, undefined);
      });
    async function read() {
      try {
        const selected = await ruleApi.resolveButton(workspace, database, row, field, signal);

        if (selected.enabled) publish(setOptions, await destinations(workspace, selected, signal));
        publish(setBinding, selected);
      } catch (e) {
        if (isRecordNotFoundError(e)) publish(setBinding, null);
        else publish(setLoadFailed, true);
      }
    }

    void read();
    return () => controller.abort();
  }, [workspace, database, row, field, reload]);

  async function setup() {
    if (!rules || sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      const rule = rules.find((r) => r.trigger.type === 'button' && r.trigger.field_id === field);

      setEditor(
        rule ? { id: rule.id, base: await ruleApi.get(workspace, database, rule.id, undefined, row) } : { id: uuid() }
      );
    } catch {
      setLoadFailed(true);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  async function run() {
    if (!binding?.enabled || sending.current || done) return;
    sending.current = true;
    setBusy(true);
    setSendError(undefined);
    try {
      const request = (pending.current ??= {
        request_id: uuid(),
        automation_id: binding.automation_id,
        expected_revision: binding.revision,
        connections: binding.connectors.map((c) => ({
          action_index: c.action_index,
          connection_id: selected[c.action_index],
        })),
      });

      await ruleApi.invokeButton(workspace, database, row, field, request);
      setDone(true);
      pending.current = undefined;
    } catch (e) {
      setSendError(isRuleConflict(e) ? 'conflict' : 'saveError');
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (editor)
    return (
      <RuleForm
        key={editor.id}
        {...{ workspace, database, caps }}
        fields={properties}
        id={editor.id}
        base={editor.base}
        buttonScope={{ row, field }}
        copyFilters={() => []}
        back={() => setEditor(undefined)}
        saved={() => {
          setEditor(undefined);
          setReload((n) => n + 1);
        }}
      />
    );
  return (
    <div className='flex flex-col gap-2'>
      {loadFailed || sendError === 'conflict' ? (
        <p role='alert'>
          {t(loadFailed ? 'databaseAutomation.loadError' : 'databaseAutomation.conflict')}{' '}
          <Button onClick={() => setReload((n) => n + 1)}>{t('databaseAutomation.reload')}</Button>
        </p>
      ) : binding === undefined ? (
        <p role='status'>{t('databaseAutomation.loading')}</p>
      ) : binding === null || !binding.enabled ? (
        <p>{t(binding === null ? 'databaseAutomation.buttonUnconfigured' : 'databaseAutomation.buttonDisabled')}</p>
      ) : done ? (
        <p role='status'>{t('databaseAutomation.buttonQueued')}</p>
      ) : (
        <>
          {binding.connectors.map((c) => (
            <fieldset key={c.action_index} disabled={busy || !!pending.current}>
              <Select
                label={t('databaseAutomation.buttonConnection', { step: c.action_index + 1, provider: c.kind })}
                options={options[c.kind] || []}
                value={selected[c.action_index] || ''}
                change={([id]) => setSelected({ ...selected, [c.action_index]: id })}
              />
            </fieldset>
          ))}
          {sendError && <p role='alert'>{t('databaseAutomation.saveError')}</p>}
          <Button
            type='button'
            disabled={busy || !binding.connectors.every((c) => selected[c.action_index])}
            onClick={() => void run()}
          >
            {t(sendError ? 'databaseAutomation.retry' : 'databaseAutomation.run')}
          </Button>
        </>
      )}
      {rules && (
        <Button type='button' variant='outline' disabled={busy} onClick={() => void setup()}>
          {t('databaseAutomation.setupRowButton')}
        </Button>
      )}
    </div>
  );
}
