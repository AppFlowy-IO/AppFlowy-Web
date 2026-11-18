import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { v4 as uuid } from 'uuid';

import { useDatabaseView, usePropertiesSelector } from '@/application/database-yjs';
import {
  DatabaseRule,
  isRuleConflict,
  ruleApi,
  RuleDefinition,
  RuleRun,
} from '@/application/services/js-services/http/automation-api';
import { YjsDatabaseKey } from '@/application/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { ConditionFields } from './ConditionFields';
import { InvocationFields } from './InvocationFields';
import {
  canEditRule,
  Capabilities,
  newAction,
  newRule,
  reorderActions,
  ruleChanges,
  RuleField,
  validRule,
} from './model';
import { ActionFields, TriggerFields } from './RuleFields';

export function RuleManager({ workspace, database, caps }: { workspace: string; database: string; caps: Capabilities }) {
  const { t } = useTranslation();
  const { properties } = usePropertiesSelector(false);
  const view = useDatabaseView();
  const [rules, setRules] = useState<DatabaseRule[]>();
  const [selected, setSelected] = useState<{ id: string; base?: DatabaseRule }>();
  const [history, setHistory] = useState<DatabaseRule>();
  const [invoke, setInvoke] = useState<DatabaseRule>();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const active = useRef<AbortController>();

  useEffect(() => {
    const ac = new AbortController();

    setError(false);
    ruleApi
      .list(workspace, database, ac.signal)
      .then((r) => {
        if (!ac.signal.aborted) setRules(r.items);
      })
      .catch(() => {
        if (!ac.signal.aborted) setError(true);
      });
    return () => {
      ac.abort();
      active.current?.abort();
    };
  }, [workspace, database, refresh]);

  async function edit(rule: DatabaseRule) {
    active.current?.abort();
    const ac = new AbortController();

    active.current = ac;
    setLoading(true);
    setError(false);
    try {
      const base = await ruleApi.get(workspace, database, rule.id, ac.signal);

      if (!ac.signal.aborted) setSelected({ id: base.id, base });
    } catch {
      if (!ac.signal.aborted) setError(true);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }

  if (invoke)
    return (
      <InvocationFields
        workspace={workspace}
        database={database}
        rule={invoke}
        back={() => {
          setInvoke(undefined);
          setRefresh((n) => n + 1);
        }}
      />
    );
  if (history)
    return (
      <History
        includeDatabase={caps.triggers.includes('scheduled')}
        workspace={workspace}
        database={database}
        rule={history}
        back={() => setHistory(undefined)}
      />
    );
  if (selected)
    return (
      <RuleForm
        key={selected.id}
        workspace={workspace}
        database={database}
        id={selected.id}
        base={selected.base}
        fields={properties}
        caps={caps}
        copyFilters={() => view?.get(YjsDatabaseKey.filters)?.toJSON() || []}
        back={() => setSelected(undefined)}
        saved={() => {
          setSelected(undefined);
          setRules(undefined);
          setRefresh((n) => n + 1);
        }}
      />
    );
  return (
    <div className='flex flex-col gap-3'>
      {error ? (
        <p role='alert'>
          {t('databaseAutomation.loadError')}{' '}
          <Button variant='ghost' onClick={() => setRefresh((n) => n + 1)}>
            {t('databaseAutomation.retry')}
          </Button>
        </p>
      ) : !rules ? (
        <p role='status'>{t('databaseAutomation.loading')}</p>
      ) : !rules.length ? (
        <p>{t('databaseAutomation.empty')}</p>
      ) : null}
      {rules?.map((rule) => (
        <div className='flex items-center gap-2 border-b border-border-primary py-2' key={rule.id}>
          <button
            className='min-w-0 flex-1 truncate text-left text-text-primary'
            disabled={loading}
            onClick={() => void edit(rule)}
          >
            {rule.name}
          </button>
          <span className='text-xs text-text-secondary'>
            {t(`databaseAutomation.status.${rule.status}`, { defaultValue: rule.status })}
          </span>
          {caps.triggers.includes(rule.trigger.type) && ['manual', 'scheduled'].includes(rule.trigger.type) && (
            <Button
              variant='ghost'
              size='sm'
              disabled={rule.trigger.type === 'manual' && !rule.enabled}
              onClick={() => setInvoke(rule)}
            >
              {t(rule.trigger.type === 'manual' ? 'databaseAutomation.run' : 'databaseAutomation.schedule')}
            </Button>
          )}
          <Button variant='ghost' size='sm' onClick={() => setHistory(rule)}>
            {t('databaseAutomation.history')}
          </Button>
        </div>
      ))}
      <Button disabled={loading} onClick={() => setSelected({ id: uuid() })}>
        {t('databaseAutomation.create')}
      </Button>
    </div>
  );
}

function RuleForm({
  workspace,
  database,
  id,
  base,
  fields,
  caps,
  copyFilters,
  back,
  saved,
}: {
  workspace: string;
  database: string;
  id: string;
  base?: DatabaseRule;
  fields: RuleField[];
  caps: Capabilities;
  copyFilters: () => unknown[];
  back: () => void;
  saved: () => void;
}) {
  const { t } = useTranslation();
  const [original, setOriginal] = useState(base);
  const [draft, setDraft] = useState<RuleDefinition>(() => base || newRule(caps));
  const [error, setError] = useState<'saveError' | 'conflict'>();
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingConditions, setEditingConditions] = useState(false);
  const running = useRef(false);
  const supported = !original || canEditRule(original, caps);
  const change = (changes: Partial<RuleDefinition>) => setDraft((prev) => ({ ...prev, ...changes }));
  const updateActions = (index: number, next: RuleDefinition['actions'][number]) =>
    change({
      actions: draft.actions.map((a, i) => (i === index ? next : a)),
    });
  const moveAction = (index: number, offset: number) => {
    const actions = draft.actions.slice();

    [actions[index], actions[index + offset]] = [actions[index + offset], actions[index]];
    change({ actions: reorderActions(draft.actions, actions) });
  };

  async function submit(remove: boolean) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (remove && original) await ruleApi.remove(workspace, database, id, original.revision);
      else if (original) await ruleApi.patch(workspace, database, id, original.revision, ruleChanges(original, draft));
      else await ruleApi.create(workspace, database, id, draft);
      saved();
    } catch (e) {
      setError(isRuleConflict(e) ? 'conflict' : 'saveError');
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  async function reload() {
    setBusy(true);
    try {
      const latest = await ruleApi.get(workspace, database, id);

      setOriginal(latest);
      setDraft(latest);
      setError(undefined);
      setDeleting(false);
    } catch {
      setError('saveError');
    } finally {
      setBusy(false);
    }
  }

  const hasChanges = !original || Object.keys(ruleChanges(original, draft)).length > 0;

  return (
    <form
      className='flex flex-col gap-3 text-sm'
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
    >
      <fieldset disabled={busy} className='flex flex-col gap-3'>
        <label>
          {t('databaseAutomation.name')}
          <Input value={draft.name} maxLength={64} required onChange={(e) => change({ name: e.target.value })} />
        </label>
        <label className='flex gap-2'>
          <input
            type='checkbox'
            checked={draft.enabled}
            disabled={!supported && !original?.enabled}
            onChange={(e) => change({ enabled: e.target.checked })}
          />
          {t('databaseAutomation.enabled')}
        </label>
        {supported ? (
          <>
            <TriggerFields
              trigger={draft.trigger}
              fields={fields}
              caps={caps}
              onChange={(trigger) => change({ trigger })}
            />
            <label>
              {t('databaseAutomation.timezone')}
              <Input required value={draft.timezone} onChange={(e) => change({ timezone: e.target.value })} />
            </label>
            <div className='flex flex-wrap items-center gap-2'>
              <span>{t('databaseAutomation.filterCount', { count: draft.conditions.length })}</span>
              {draft.trigger.type !== 'row_deleted' && (
                <Button type='button' variant='ghost' size='sm' onClick={() => change({ conditions: copyFilters() })}>
                  {t('databaseAutomation.useFilters')}
                </Button>
              )}
              {draft.conditions.length > 0 && (
                <Button type='button' variant='ghost' size='sm' onClick={() => change({ conditions: [] })}>
                  {t('databaseAutomation.clearFilters')}
                </Button>
              )}
            </div>
            {draft.trigger.type !== 'row_deleted' && (
              <>
                <Button type='button' size='sm' variant='ghost' onClick={() => setEditingConditions((open) => !open)}>
                  {t(editingConditions ? 'databaseAutomation.closeConditions' : 'databaseAutomation.editConditions')}
                </Button>
                {editingConditions && (
                  <ConditionFields
                    source
                    fields={fields}
                    conditions={draft.conditions}
                    change={(conditions) => change({ conditions })}
                  />
                )}
              </>
            )}
            {draft.actions.map((action, index) => (
              <fieldset className='flex flex-col gap-2 rounded-400 border border-border-primary p-3' key={index}>
                <legend>{t('databaseAutomation.step', { n: index + 1 })}</legend>
                <ActionFields
                  workspace={workspace}
                  previous={draft.actions.slice(0, index)}
                  action={action}
                  fields={fields}
                  caps={caps}
                  deleted={draft.trigger.type === 'row_deleted'}
                  change={(a) => updateActions(index, a)}
                />
                <div className='flex gap-2'>
                  {index > 0 && (
                    <Button variant='ghost' size='sm' type='button' onClick={() => moveAction(index, -1)}>
                      {t('databaseAutomation.up')}
                    </Button>
                  )}
                  {index < draft.actions.length - 1 && (
                    <Button variant='ghost' size='sm' type='button' onClick={() => moveAction(index, 1)}>
                      {t('databaseAutomation.down')}
                    </Button>
                  )}
                  <Button
                    variant='ghost'
                    size='sm'
                    type='button'
                    disabled={draft.actions.length === 1}
                    onClick={() =>
                      change({
                        actions: reorderActions(
                          draft.actions,
                          draft.actions.filter((_, i) => i !== index)
                        ),
                      })
                    }
                  >
                    {t('databaseAutomation.remove')}
                  </Button>
                </div>
              </fieldset>
            ))}
            {draft.actions.length < 5 && (
              <Button
                variant='outline'
                type='button'
                onClick={() => change({ actions: [...draft.actions, newAction(caps.actions[0])] })}
              >
                {t('databaseAutomation.addAction')}
              </Button>
            )}
          </>
        ) : (
          <p role='status'>{t('databaseAutomation.unsupported')}</p>
        )}
      </fieldset>
      {error && (
        <div role='alert' className='text-text-error'>
          {t(`databaseAutomation.${error}`)}
          {error === 'conflict' && (
            <Button type='button' disabled={busy} variant='ghost' onClick={() => void reload()}>
              {t('databaseAutomation.reload')}
            </Button>
          )}
        </div>
      )}
      {deleting ? (
        <div>
          <p>{t('databaseAutomation.confirmDelete', { name: draft.name })}</p>
          <Button
            type='button'
            disabled={busy || error === 'conflict'}
            variant='destructive'
            onClick={() => void submit(true)}
          >
            {t('databaseAutomation.delete')}
          </Button>
          <Button type='button' disabled={busy} variant='ghost' onClick={() => setDeleting(false)}>
            {t('databaseAutomation.cancel')}
          </Button>
        </div>
      ) : (
        <div className='flex justify-between gap-2'>
          {original && (
            <Button type='button' variant='destructive-outline' disabled={busy} onClick={() => setDeleting(true)}>
              {t('databaseAutomation.delete')}
            </Button>
          )}
          <Button variant='ghost' type='button' disabled={busy} onClick={back}>
            {t('databaseAutomation.cancel')}
          </Button>
          <Button
            type='submit'
            disabled={
              busy || error === 'conflict' || !hasChanges || !draft.name.trim() || (supported && !validRule(draft))
            }
          >
            {t('databaseAutomation.save')}
          </Button>
        </div>
      )}
    </form>
  );
}

function History({
  includeDatabase,
  workspace,
  database,
  rule,
  back,
}: {
  includeDatabase: boolean;
  workspace: string;
  database: string;
  rule: DatabaseRule;
  back: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [runs, setRuns] = useState<RuleRun[]>([]);
  const [cursor, setCursor] = useState<number>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const active = useRef<AbortController>();

  async function load(before?: number) {
    active.current?.abort();
    const ac = new AbortController();

    active.current = ac;
    setBusy(true);
    setError(false);
    try {
      const page = await ruleApi.runs(workspace, database, rule.id, before, ac.signal, includeDatabase);

      if (!ac.signal.aborted) {
        setRuns((old) => (before === undefined ? page.items : [...old, ...page.items]));
        setCursor(page.next_cursor);
      }
    } catch {
      if (!ac.signal.aborted) setError(true);
    } finally {
      if (!ac.signal.aborted) setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    return () => active.current?.abort();
  }, [workspace, database, rule.id, includeDatabase]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className='flex flex-col gap-3'>
      <h3>
        {rule.name} · {t('databaseAutomation.history')}
      </h3>
      {runs.map((run) => (
        <div key={run.id} className='border-b border-border-primary py-2'>
          <span>
            {new Date(run.event_observed_at).toLocaleString(i18n.language)} ·{' '}
            {t(`databaseAutomation.status.${run.status}`, { defaultValue: run.status })}
          </span>
          <div className='text-sm text-text-secondary'>
            {t('databaseAutomation.runCounts', { attempts: run.attempts, count: run.notified_count })}
            {run.reason &&
              ` · ${t(`databaseAutomation.reasons.${run.reason}`, { defaultValue: run.reason.replaceAll('_', ' ') })}`}
          </div>
        </div>
      ))}
      {!busy && !error && !runs.length && <p>{t('databaseAutomation.noRuns')}</p>}
      {busy && <p role='status'>{t('databaseAutomation.loading')}</p>}
      {error && <p role='alert'>{t('databaseAutomation.loadError')}</p>}
      {(error || cursor !== undefined) && (
        <Button disabled={busy} variant='outline' onClick={() => void load(cursor)}>
          {t(error ? 'databaseAutomation.retry' : 'databaseAutomation.more')}
        </Button>
      )}
      <Button variant='ghost' onClick={back}>
        {t('databaseAutomation.back')}
      </Button>
    </section>
  );
}
