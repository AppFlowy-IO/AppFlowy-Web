import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { v4 as uuid, validate as isUuid } from 'uuid';

import { useRowOrdersSelector } from '@/application/database-yjs';
import {
  DatabaseRule,
  isRuleConflict,
  isCustomSchedule,
  ruleApi,
  RuleSchedule,
} from '@/application/services/js-services/http/automation-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toIntlLocale } from '@/i18n/intl-locale';

import { Select } from './Select';

export function InvocationFields({
  workspace,
  database,
  rule,
  back,
  customRecurrence,
  fixedRow,
}: {
  workspace: string;
  database: string;
  rule: DatabaseRule;
  back: () => void;
  customRecurrence: boolean;
  fixedRow?: string;
}) {
  const { t, i18n } = useTranslation();
  const scheduled = rule.trigger.type === 'scheduled';
  const rowRequired = !scheduled || rule.actions.some((action) => action.type === 'webhook_properties');
  const [revision, setRevision] = useState(rule.revision);
  const [schedule, setSchedule] = useState<RuleSchedule>(() => ({
    ...(fixedRow && { row_id: fixedRow }),
    frequency: 'daily',
    starts_on: '',
    local_time: '09:00:00',
    timezone: rule.timezone,
  }));
  const [loadedCustom, setLoadedCustom] = useState(false);
  const [loading, setLoading] = useState(scheduled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'loadError' | 'saveError' | 'conflict'>();
  const [refresh, setRefresh] = useState(0);
  const sending = useRef(false);
  const [runId, setRunId] = useState<string>();
  const [next, setNext] = useState<string | null>();
  const request = useRef<{ row: string; id: string }>();
  const rows = useRowOrdersSelector({ publish: false });

  useEffect(() => {
    const ac = new AbortController();

    async function load() {
      if (!scheduled && refresh === 0) return;
      setLoading(true);
      setError(undefined);
      try {
        const current = await ruleApi.get(workspace, database, rule.id, ac.signal);

        if (ac.signal.aborted) return;
        setRevision(current.revision);
        if (scheduled) {
          try {
            const state = await ruleApi.getSchedule(workspace, database, rule.id, ac.signal);

            if (ac.signal.aborted) return;
            const { row_id, frequency, starts_on, ends_on, local_time, timezone, interval, weekdays } = state;

            if (!customRecurrence && isCustomSchedule(state)) {
              throw new Error('Calendar requires a newer server capability');
            }

            setLoadedCustom(isCustomSchedule(state));
            setSchedule({
              row_id,
              frequency,
              starts_on,
              ends_on,
              local_time,
              timezone,
              ...(customRecurrence && { interval: interval ?? 1, weekdays: weekdays ?? [] }),
            });
            setNext(state.next_due_at);
            setRevision(state.revision);
          } catch (e) {
            if (!e || typeof e !== 'object' || !('code' in e) || e.code !== -2) throw e;
            setLoadedCustom(false);
          }
        }
      } catch {
        if (!ac.signal.aborted) setError('loadError');
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => ac.abort();
  }, [workspace, database, rule.id, scheduled, refresh, customRecurrence]);
  const set = (updates: Partial<RuleSchedule>) => setSchedule((s) => ({ ...s, ...updates }));

  async function submit() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (scheduled) {
        const saved = await ruleApi.putSchedule(workspace, database, rule.id, revision, {
          ...schedule,
          ...(customRecurrence && loadedCustom && !isCustomSchedule(schedule) && { replace_custom_recurrence: true }),
          row_id: schedule.row_id || undefined,
          local_time: schedule.local_time.length === 5 ? schedule.local_time + ':00' : schedule.local_time,
        });

        setRevision(saved.revision);
        setNext(saved.next_due_at);
        back();
      } else {
        if (!schedule.row_id) return;
        if (request.current?.row !== schedule.row_id) request.current = { row: schedule.row_id, id: uuid() };
        const result = await ruleApi.run(workspace, database, rule.id, revision, schedule.row_id, request.current.id);

        setRunId(result);
      }
    } catch (e) {
      setError(isRuleConflict(e) ? 'conflict' : 'saveError');
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const valid =
    ((!rowRequired && !schedule.row_id) || isUuid(schedule.row_id || '')) &&
    (!scheduled ||
      (!!schedule.starts_on &&
        !!schedule.local_time &&
        !!schedule.timezone &&
        (!customRecurrence ||
          (Number.isInteger(schedule.interval ?? 1) &&
            (schedule.interval ?? 1) >= 1 &&
            (schedule.interval ?? 1) <= 999)) &&
        (!schedule.ends_on || schedule.ends_on >= schedule.starts_on)));

  return (
    <form
      className='flex flex-col gap-3 text-sm'
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3>{rule.name}</h3>
      <fieldset disabled={loading || busy || !!runId} className='flex flex-col gap-3'>
        <label>
          {t(rowRequired ? 'databaseAutomation.rowId' : 'databaseAutomation.optionalRow')}
          <Input
            readOnly={!!fixedRow}
            list={fixedRow ? undefined : 'automation-invocation-rows'}
            required={rowRequired}
            value={schedule.row_id || ''}
            onChange={(e) => set({ row_id: e.target.value })}
          />
        </label>
        {!fixedRow && (
          <datalist id='automation-invocation-rows'>
            {rows?.map((r) => (
              <option key={r.id} value={r.id} />
            ))}
          </datalist>
        )}
        {scheduled && (
          <>
            <Select
              label={t('databaseAutomation.frequency')}
              value={schedule.frequency}
              options={(customRecurrence
                ? ['daily', 'weekly', 'monthly', 'yearly']
                : ['daily', 'weekly', 'monthly']
              ).map((id) => ({
                id,
                name: t(`databaseAutomation.kinds.${id}`, { defaultValue: id }),
              }))}
              change={([f]) => {
                if (f)
                  set({ frequency: f as RuleSchedule['frequency'], ...(f !== 'weekly' && { weekdays: undefined }) });
              }}
            />
            {customRecurrence && (
              <label>
                {t('databaseAutomation.interval')}
                <Input
                  type='number'
                  min={1}
                  max={999}
                  step={1}
                  required
                  value={schedule.interval === 0 ? '' : schedule.interval ?? 1}
                  onChange={(e) => set({ interval: Number(e.target.value) })}
                />
              </label>
            )}
            {customRecurrence && schedule.frequency === 'weekly' && (
              <Select
                multiple
                label={t('databaseAutomation.weekdays')}
                value={(schedule.weekdays ?? []).map(String)}
                options={Array.from({ length: 7 }, (_, i) => ({
                  id: String(i + 1),
                  name: new Intl.DateTimeFormat(toIntlLocale(i18n.language), {
                    weekday: 'long',
                    timeZone: 'UTC',
                  }).format(Date.UTC(2024, 0, i + 1)),
                }))}
                change={(ids) => set({ weekdays: ids.map(Number) })}
              />
            )}
            <label>
              {t('databaseAutomation.startsOn')}
              <Input
                type='date'
                required
                value={schedule.starts_on}
                onChange={(e) => set({ starts_on: e.target.value })}
              />
            </label>
            <label>
              {t('databaseAutomation.endsOn')}
              <Input
                type='date'
                min={schedule.starts_on}
                value={schedule.ends_on || ''}
                onChange={(e) => set({ ends_on: e.target.value || undefined })}
              />
            </label>
            <label>
              {t('databaseAutomation.localTime')}
              <Input
                type='time'
                step={1}
                required
                value={schedule.local_time}
                onChange={(e) => set({ local_time: e.target.value })}
              />
            </label>
            <label>
              {t('databaseAutomation.timezone')}
              <Input required value={schedule.timezone} onChange={(e) => set({ timezone: e.target.value })} />
            </label>
            {next && <p>{t('databaseAutomation.nextRun', { date: new Date(next).toLocaleString() })}</p>}
          </>
        )}
      </fieldset>
      {runId && <p role='status'>{t('databaseAutomation.queued')}</p>}
      {error && (
        <div role='alert'>
          {t(`databaseAutomation.${error}`)}
          {error !== 'saveError' && (
            <Button type='button' variant='ghost' onClick={() => setRefresh((n) => n + 1)}>
              {t(error === 'conflict' ? 'databaseAutomation.reload' : 'databaseAutomation.retry')}
            </Button>
          )}
        </div>
      )}
      {!runId && (
        <Button type='submit' disabled={busy || loading || !valid || error === 'conflict' || error === 'loadError'}>
          {t(scheduled ? 'databaseAutomation.save' : 'databaseAutomation.run')}
        </Button>
      )}
      <Button type='button' disabled={busy} variant='ghost' onClick={back}>
        {t('databaseAutomation.back')}
      </Button>
    </form>
  );
}
