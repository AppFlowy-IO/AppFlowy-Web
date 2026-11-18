import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType } from '@/application/database-yjs';
import {
  AutomationText,
  PropertyValue,
  RuleAction,
  ruleApi,
  TargetDatabase,
  TargetField,
  TextPart,
} from '@/application/services/js-services/http/automation-api';
import { listConnections, queryIntegration } from '@/application/services/js-services/http/integration-api';
import { useMentionableUsers } from '@/components/database/components/cell/person/useMentionableUsers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { ConditionFields } from './ConditionFields';
import { EndpointControls, ConnectAccount } from './DestinationSettings';
import { arithmetic, formula, relationVariables, RuleField, valueKinds } from './model';
import { Select, Item } from './Select';

export function TextFields({
  label,
  value,
  fields,
  previous,
  change,
}: {
  label: string;
  value?: AutomationText;
  fields: RuleField[];
  previous: RuleAction[];
  change: (v: AutomationText) => void;
}) {
  const { t } = useTranslation();

  if (typeof value !== 'object')
    return (
      <div>
        <label>
          {label}
          <Input value={value || ''} onChange={(e) => change(e.target.value)} />
        </label>
        <Button
          size='sm'
          variant='ghost'
          type='button'
          onClick={() => change({ parts: [{ type: 'text', value: value || '' }] })}
        >
          {t('databaseAutomation.template')}
        </Button>
      </div>
    );
  const parts = value.parts;
  const variables = previous
    .filter((a) => a.type === 'define_variable' && a.name)
    .map((a) => ({ id: a.name!, name: a.name! }));
  const steps = previous.flatMap((a, i) =>
    a.type === 'create_row' ? [{ id: String(i), name: t('databaseAutomation.step', { n: i + 1 }) }] : []
  );

  function write(i: number, part: TextPart) {
    change({ parts: parts.map((p, n) => (i === n ? part : p)) });
  }

  return (
    <fieldset className='flex flex-col gap-2'>
      <legend>{label}</legend>
      {parts.map((p, i) => (
        <div key={i} className='flex flex-wrap items-center gap-2'>
          <Select
            label={t('databaseAutomation.source')}
            value={p.type}
            options={[
              'text',
              'field',
              ...(variables.length ? ['variable'] : []),
              ...(steps.length ? ['step_row_id'] : []),
            ].map((id) => ({ id, name: t(`databaseAutomation.kinds.${id}`, { defaultValue: id }) }))}
            change={([type]) => {
              if (type === 'field') write(i, { type, field_id: fields[0]?.id || '' });
              else if (type === 'variable') write(i, { type, name: variables[0]?.id || '' });
              else if (type === 'step_row_id') write(i, { type, action_index: Number(steps[0]?.id) });
              else write(i, { type: 'text', value: '' });
            }}
          />
          {p.type === 'text' ? (
            <Input
              aria-label={t('databaseAutomation.value')}
              value={p.value}
              onChange={(e) => write(i, { ...p, value: e.target.value })}
            />
          ) : (
            <Select
              label={t('databaseAutomation.value')}
              value={p.type === 'field' ? p.field_id : p.type === 'variable' ? p.name : String(p.action_index)}
              options={p.type === 'field' ? fields : p.type === 'variable' ? variables : steps}
              change={([v]) =>
                write(
                  i,
                  p.type === 'field'
                    ? { ...p, field_id: v }
                    : p.type === 'variable'
                    ? { ...p, name: v }
                    : { ...p, action_index: Number(v) }
                )
              }
            />
          )}
          <Button
            variant='ghost'
            size='sm'
            type='button'
            onClick={() => change({ parts: parts.filter((_, n) => n !== i) })}
          >
            {t('databaseAutomation.removePart')}
          </Button>
        </div>
      ))}
      <Button variant='outline' type='button' onClick={() => change({ parts: [...parts, { type: 'text', value: '' }] })}>
        {t('databaseAutomation.addPart')}
      </Button>
      <Button
        variant='ghost'
        size='sm'
        type='button'
        onClick={() =>
          change(
            parts
              .filter((p) => p.type === 'text')
              .map((p) => (p as { value: string }).value)
              .join('')
          )
        }
      >
        {t('databaseAutomation.literal')}
      </Button>
    </fieldset>
  );
}

export function SourceValue({
  value,
  change,
  fields,
  previous,
  literals,
  options = [],
  extended = true,
  definition = false,
}: {
  value: PropertyValue;
  change: (v: PropertyValue) => void;
  fields: RuleField[];
  previous: RuleAction[];
  literals: string[];
  options?: Item[];
  extended?: boolean;
  definition?: boolean;
}) {
  const { t } = useTranslation();
  const multiSelect = value.kind === 'multi_select' || value.kind === 'multi_select_delta';
  const names = previous
    .filter((a) => a.type === 'define_variable' && a.name)
    .map((a) => ({ id: a.name!, name: a.name! }));
  const kinds = extended
    ? [
        ...literals,
        'field',
        ...(names.length ? ['variable'] : []),
        ...(literals.includes('text') ? ['template'] : []),
        ...(literals.some((k) => k === 'number' || k === 'date_time') ? ['formula'] : []),
      ]
    : literals;

  return (
    <>
      {kinds.length > 1 && (
        <Select
          label={t(extended ? 'databaseAutomation.source' : 'databaseAutomation.dateSource')}
          value={multiSelect ? 'multi_select' : value.kind}
          options={kinds.map((id) => ({ id, name: t(`databaseAutomation.kinds.${id}`, { defaultValue: id }) }))}
          change={([kind]) => {
            if (kind === 'field') change({ kind, field_id: fields[0]?.id || '' });
            else if (kind === 'variable') change({ kind, name: names[0]?.id || '' });
            else if (kind === 'formula')
              change({
                kind,
                value: {
                  operator: literals.includes('number') ? 'add' : 'add_days',
                  left: literals.includes('number') ? { kind: 'number', value: 0 } : { kind: 'event_time' },
                  right: { kind: 'number', value: 1 },
                },
              });
            else if (kind === 'template') change({ kind, parts: [{ type: 'text', value: '' }] });
            else if (kind === 'event_time' || kind === 'number') change({ kind });
            else
              change({
                kind,
                value: ['multi_select', 'person', 'relation'].includes(kind) ? [] : kind === 'checkbox' ? false : '',
              });
          }}
        />
      )}
      {value.kind === 'formula' && formula(value) ? (
        <FormulaFields
          value={formula(value)!}
          fields={fields}
          previous={previous}
          change={(v) => change({ kind: 'formula', value: v })}
        />
      ) : value.kind === 'template' ? (
        <TextFields
          label={t('databaseAutomation.value')}
          value={{ parts: value.parts || [] }}
          fields={fields}
          previous={previous}
          change={(v) =>
            change(typeof v === 'string' ? { kind: 'text', value: v } : { kind: 'template', parts: v.parts })
          }
        />
      ) : value.kind === 'field' || value.kind === 'variable' ? (
        <Select
          label={t('databaseAutomation.value')}
          value={value.field_id || value.name || ''}
          options={value.kind === 'field' ? fields : names}
          change={([id]) =>
            change(value.kind === 'field' ? { kind: 'field', field_id: id } : { kind: 'variable', name: id })
          }
        />
      ) : ['person', 'relation'].includes(value.kind) ? (
        <IdentityValue value={value} change={change} definition={definition} />
      ) : value.kind === 'single_select' || multiSelect ? (
        <>
          {multiSelect && extended && (
            <Select
              label={t('databaseAutomation.operator')}
              value={value.operation || 'replace'}
              options={['replace', 'add', 'remove'].map((id) => ({
                id,
                name: t(`databaseAutomation.kinds.${id}`, { defaultValue: id }),
              }))}
              change={([operation]) => {
                const ids = Array.isArray(value.value) ? value.value : [];

                change(
                  operation === 'add' || operation === 'remove'
                    ? { kind: 'multi_select_delta', operation, value: ids }
                    : { kind: 'multi_select', value: ids }
                );
              }}
            />
          )}
          <Select
            label={t('databaseAutomation.option')}
            value={(value.value as string | string[]) || (multiSelect ? [] : '')}
            options={options}
            multiple={multiSelect}
            change={(ids) => change({ ...value, value: multiSelect ? ids : ids[0] })}
          />
        </>
      ) : value.kind === 'checkbox' ? (
        <label>
          <input
            type='checkbox'
            checked={value.value === true}
            onChange={(e) => change({ ...value, value: e.target.checked })}
          />
          {t('databaseAutomation.checked')}
        </label>
      ) : (
        value.kind !== 'event_time' && (
          <label>
            {t(value.kind === 'date_time' ? 'databaseAutomation.dateTime' : 'databaseAutomation.value')}
            <Input
              value={String(value.value ?? '')}
              type={value.kind === 'number' ? 'number' : 'text'}
              step='any'
              onChange={(e) =>
                change({
                  ...value,
                  value:
                    value.kind === 'number'
                      ? e.target.value === ''
                        ? undefined
                        : e.target.valueAsNumber
                      : e.target.value,
                })
              }
            />
          </label>
        )
      )}
    </>
  );
}

function IdentityValue({
  value,
  change,
  definition,
}: {
  value: PropertyValue;
  change: (v: PropertyValue) => void;
  definition: boolean;
}) {
  const { t } = useTranslation();
  const { users, fetchUsers } = useMentionableUsers();
  const [entry, setEntry] = useState('');
  const ids = Array.isArray(value.value) ? value.value : [];

  useEffect(() => {
    if (value.kind === 'person') void fetchUsers();
  }, [value.kind, fetchUsers]);
  return (
    <>
      {!definition && (
        <Select
          label={t('databaseAutomation.operator')}
          value={value.operation || 'replace'}
          options={['replace', 'add', 'remove'].map((id) => ({
            id,
            name: t(`databaseAutomation.kinds.${id}`, { defaultValue: id }),
          }))}
          change={([op]) => change({ ...value, operation: op as PropertyValue['operation'] })}
        />
      )}
      {value.kind === 'person' ? (
        <Select
          label={t('databaseAutomation.people')}
          multiple
          value={ids}
          options={users.map((u) => ({ id: u.person_id, name: u.name || u.email }))}
          change={(valueIds) => change({ ...value, value: valueIds })}
        />
      ) : (
        <>
          <ul>
            {ids.map((id) => (
              <li key={id}>
                {id}
                <Button
                  variant='ghost'
                  type='button'
                  onClick={() => change({ ...value, value: ids.filter((v) => v !== id) })}
                >
                  {t('databaseAutomation.removeRelation')}
                </Button>
              </li>
            ))}
          </ul>
          <label>
            {t('databaseAutomation.rowId')}
            <Input value={entry} onChange={(e) => setEntry(e.target.value)} />
          </label>
          <Button
            variant='outline'
            type='button'
            disabled={!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(entry) || ids.includes(entry)}
            onClick={() => {
              change({ ...value, value: [...ids, entry] });
              setEntry('');
            }}
          >
            {t('databaseAutomation.addRelation')}
          </Button>
        </>
      )}
    </>
  );
}

function FormulaFields({
  value,
  fields,
  previous,
  change,
}: {
  value: NonNullable<ReturnType<typeof formula>>;
  fields: RuleField[];
  previous: RuleAction[];
  change: (f: NonNullable<ReturnType<typeof formula>>) => void;
}) {
  const { t } = useTranslation();

  return (
    <fieldset className='flex flex-col gap-2 border-l border-border-primary pl-2'>
      <Select
        label={t('databaseAutomation.operator')}
        value={value.operator}
        options={arithmetic.map((id) => ({ id, name: t(`databaseAutomation.kinds.${id}`, { defaultValue: id }) }))}
        change={([op]) => {
          if (arithmetic.includes(op as typeof value.operator))
            change({ ...value, operator: op as typeof value.operator });
        }}
      />
      {(['left', 'right'] as const).map((side) => (
        <fieldset key={side}>
          <legend>{t(side === 'left' ? 'databaseAutomation.firstOperand' : 'databaseAutomation.secondOperand')}</legend>
          <SourceValue
            value={value[side]}
            literals={side === 'left' && value.operator === 'add_days' ? ['date_time', 'event_time'] : ['number']}
            fields={fields}
            previous={previous}
            change={(v) => change({ ...value, [side]: v })}
          />
        </fieldset>
      ))}
    </fieldset>
  );
}

function TargetFields({
  workspace,
  action,
  change,
  fields,
  previous,
  extended,
}: {
  workspace: string;
  action: RuleAction;
  change: (a: RuleAction) => void;
  fields: RuleField[];
  previous: RuleAction[];
  extended: boolean;
}) {
  const { t } = useTranslation();
  const relationNames = extended ? relationVariables(previous, fields) : [];
  const [dbs, setDbs] = useState<TargetDatabase[]>([]);
  const [more, setMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [target, setTarget] = useState<TargetField[]>([]);
  const [err, setErr] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const ac = new AbortController();

    ruleApi
      .databases(workspace, offset, ac.signal)
      .then((p) => {
        if (!ac.signal.aborted) {
          setDbs((old) => (offset ? [...old, ...p.databases] : p.databases));
          setMore(p.has_more);
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) setErr(true);
      });
    return () => ac.abort();
  }, [workspace, offset, retry]);
  useEffect(() => {
    const ac = new AbortController();

    setTarget([]);
    if (action.database_id)
      ruleApi
        .fields(workspace, action.database_id, ac.signal)
        .then((f) => {
          if (!ac.signal.aborted) setTarget(f);
        })
        .catch(() => {
          if (!ac.signal.aborted) setErr(true);
        });
    return () => ac.abort();
  }, [workspace, action.database_id, retry]);
  const chosen = dbs.find((d) => d.database_id === action.database_id);
  const props = action.properties || [];

  return (
    <>
      <Select
        label={t('databaseAutomation.targetDatabase')}
        value={action.database_id || ''}
        options={dbs.map((d) => ({ id: d.database_id, name: d.views[0]?.name || d.database_id }))}
        change={([id]) =>
          change({
            ...action,
            database_id: id,
            ...(action.type === 'create_row'
              ? { view_id: dbs.find((d) => d.database_id === id)?.views[0]?.view_id || '' }
              : {}),
            properties: [],
          })
        }
      />
      {more && (
        <Button type='button' variant='ghost' onClick={() => setOffset(dbs.length)}>
          {t('databaseAutomation.more')}
        </Button>
      )}
      {err && (
        <Button
          type='button'
          variant='ghost'
          onClick={() => {
            setErr(false);
            setRetry((n) => n + 1);
          }}
        >
          {t('databaseAutomation.retry')}
        </Button>
      )}
      {action.type === 'create_row' ? (
        <Select
          label={t('databaseAutomation.view')}
          value={action.view_id || ''}
          options={(chosen?.views || []).map((v) => ({ id: v.view_id, name: v.name }))}
          change={([view_id]) => change({ ...action, view_id })}
        />
      ) : (
        <>
          <Select
            label={t('databaseAutomation.targetRow')}
            value={action.row?.type || ''}
            options={[
              'trigger',
              'id',
              'matching',
              ...(relationNames.length ? ['variable'] : []),
              ...(previous.some((a) => a.type === 'create_row') ? ['step'] : []),
            ].map((id) => ({
              id,
              name: t(`databaseAutomation.kinds.${id}`, { defaultValue: id }),
            }))}
            change={([type]) =>
              change({
                ...action,
                row:
                  type === 'variable'
                    ? { type, name: relationNames[0] }
                    : type === 'matching'
                    ? { type, conditions: [] }
                    : type === 'trigger'
                    ? { type }
                    : type === 'step'
                    ? { type, action_index: previous.findIndex((a) => a.type === 'create_row') }
                    : { type: 'id', row_id: '' },
              })
            }
          />
          {action.row?.type === 'variable' && (
            <Select
              label={t('databaseAutomation.variableName')}
              value={action.row.name}
              options={relationNames.map((name) => ({ id: name, name }))}
              change={([name]) => change({ ...action, row: { type: 'variable', name } })}
            />
          )}
          {action.row?.type === 'matching' && (
            <ConditionFields
              source={false}
              fields={target.map((f) => ({
                id: f.id,
                name: f.name,
                type: f.field_type_id as FieldType,
                options: f.type_option?.content?.options,
              }))}
              conditions={action.row.conditions}
              change={(conditions) => change({ ...action, row: { type: 'matching', conditions } })}
            />
          )}
          {action.row?.type === 'id' && (
            <label>
              {t('databaseAutomation.rowId')}
              <Input
                required
                value={action.row.row_id}
                onChange={(e) => change({ ...action, row: { type: 'id', row_id: e.target.value } })}
              />
            </label>
          )}
          {action.row?.type === 'step' && (
            <Select
              label={t('databaseAutomation.stepResult')}
              value={String(action.row.action_index)}
              options={previous.flatMap((a, i) =>
                a.type === 'create_row' ? [{ id: String(i), name: t('databaseAutomation.step', { n: i + 1 }) }] : []
              )}
              change={([i]) => change({ ...action, row: { type: 'step', action_index: Number(i) } })}
            />
          )}
        </>
      )}
      {props.map((p, i) => {
        const f = target.find((f) => f.id === p.field_id);
        const write = (field_id: string, value: PropertyValue) =>
          change({ ...action, properties: props.map((q, n) => (n === i ? { field_id, value } : q)) });

        return (
          <fieldset className='flex flex-col gap-2' key={i}>
            <Select
              label={t('databaseAutomation.property')}
              value={p.field_id}
              options={target.filter((f) => valueKinds(f.field_type_id as FieldType).length)}
              change={([id]) =>
                write(id, { kind: valueKinds(target.find((f) => f.id === id)?.field_type_id as FieldType)[0] || 'text' })
              }
            />
            {f && (
              <SourceValue
                extended={extended}
                fields={fields}
                previous={previous}
                value={p.value}
                literals={valueKinds(f.field_type_id as FieldType)}
                options={f.type_option?.content?.options}
                change={(v) => write(p.field_id, v)}
              />
            )}
            <Button
              variant='ghost'
              type='button'
              onClick={() => change({ ...action, properties: props.filter((_, n) => n !== i) })}
            >
              {t('databaseAutomation.removeProperty')}
            </Button>
          </fieldset>
        );
      })}
      <Button
        variant='outline'
        type='button'
        disabled={!action.database_id}
        onClick={() =>
          change({ ...action, properties: [...props, { field_id: '', value: { kind: 'text', value: '' } }] })
        }
      >
        {t('databaseAutomation.addProperty')}
      </Button>
    </>
  );
}

export function WorkflowFields({
  workspace,
  action,
  change,
  fields,
  previous,
  extended,
  webhookHeaders,
}: {
  workspace: string;
  action: RuleAction;
  change: (a: RuleAction) => void;
  fields: RuleField[];
  previous: RuleAction[];
  extended: boolean;
  webhookHeaders: boolean;
}) {
  const { t } = useTranslation();
  const { users, fetchUsers } = useMentionableUsers();
  const [targets, setTargets] = useState<Item[]>([]);
  const [channels, setChannels] = useState<Item[]>([]);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const ac = new AbortController();

    setTargets([]);
    setError(false);
    async function read() {
      if (['webhook', 'webhook_properties'].includes(action.type)) {
        let after: string | undefined;
        const results: Item[] = [];

        do {
          const page = await ruleApi.webhooks(workspace, after, ac.signal);

          results.push(...page.items.filter((item) => !item.disabled));
          after = page.next_cursor;
        } while (after && !ac.signal.aborted);

        return results;
      }

      if (['slack', 'connected_email', 'addressed_email'].includes(action.type))
        return (await listConnections(workspace, ac.signal))
          .filter((c) => c.provider === (action.type === 'slack' ? 'slack' : 'gmail') && c.status === 'active')
          .map((c) => ({ id: c.id, name: c.account_identifier || c.id }));
      if (action.type === 'email') await fetchUsers();
      return [];
    }

    void read()
      .then((items) => {
        if (!ac.signal.aborted) setTargets(items);
      })
      .catch(() => {
        if (!ac.signal.aborted) setError(true);
      });
    return () => ac.abort();
  }, [workspace, action.type, retry, fetchUsers]);
  useEffect(() => {
    const ac = new AbortController();

    setChannels([]);
    async function read() {
      if (action.type !== 'slack' || !action.connection_id) return [];
      let cursor: string | undefined;
      const all: Item[] = [];

      do {
        const p = await queryIntegration<{ channels: Item[]; response_metadata?: { next_cursor?: string } }>(
          workspace,
          action.connection_id,
          'conversations.list',
          { limit: '200', exclude_archived: 'true', ...(cursor ? { cursor } : {}) },
          ac.signal
        );

        all.push(...p.channels);
        cursor = p.response_metadata?.next_cursor;
      } while (cursor && !ac.signal.aborted);

      return all;
    }

    void read()
      .then((result) => {
        if (!ac.signal.aborted) setChannels(result);
      })
      .catch(() => {
        if (!ac.signal.aborted) setError(true);
      });
    return () => ac.abort();
  }, [workspace, action.type, action.connection_id, retry]);
  if (action.type === 'create_row' || action.type === 'edit_row')
    return <TargetFields {...{ workspace, action, change, fields, previous, extended }} />;
  if (action.type === 'define_variable')
    return (
      <>
        <label>
          {t('databaseAutomation.variableName')}
          <Input value={action.name || ''} onChange={(e) => change({ ...action, name: e.target.value })} />
        </label>
        <SourceValue
          value={action.value || { kind: 'text', value: '' }}
          fields={fields}
          previous={previous}
          definition
          literals={['text', 'number', 'checkbox', 'date_time', 'event_time', 'relation']}
          change={(value) => change({ ...action, value })}
        />
      </>
    );
  return (
    <>
      {error && (
        <Button
          variant='ghost'
          type='button'
          onClick={() => {
            setError(false);
            setRetry((n) => n + 1);
          }}
        >
          {t('databaseAutomation.retry')}
        </Button>
      )}
      {['webhook', 'webhook_properties'].includes(action.type) && (
        <Select
          label={t('databaseAutomation.endpoint')}
          value={action.endpoint_id || ''}
          options={targets}
          change={([endpoint_id]) => change({ ...action, endpoint_id })}
        />
      )}
      {['webhook', 'webhook_properties'].includes(action.type) && (
        <EndpointControls
          allowHeaders={webhookHeaders}
          workspace={workspace}
          selected={action.endpoint_id}
          onChange={(endpoint_id) => {
            change({ ...action, endpoint_id });
            setRetry((n) => n + 1);
          }}
        />
      )}
      {action.type === 'webhook_properties' && (
        <Select
          multiple
          label={t('databaseAutomation.webhookProperties')}
          options={fields.map(({ id, name }) => ({ id, name }))}
          value={action.property_ids ?? []}
          change={(property_ids) => change({ ...action, property_ids })}
        />
      )}
      {action.type === 'slack' && (
        <ConnectAccount
          workspace={workspace}
          connected={(connection_id) => {
            change({ ...action, connection_id, channel_id: '' });
            setRetry((n) => n + 1);
          }}
        />
      )}
      {action.type === 'slack' && (
        <>
          <Select
            label={t('databaseAutomation.connection')}
            value={action.connection_id || ''}
            options={targets}
            change={([connection_id]) => change({ ...action, connection_id, channel_id: '' })}
          />
          <Select
            label={t('databaseAutomation.channel')}
            value={action.channel_id || ''}
            options={channels}
            change={([channel_id]) => change({ ...action, channel_id })}
          />
        </>
      )}
      {['connected_email', 'addressed_email'].includes(action.type) && (
        <>
          <Select
            label={t('databaseAutomation.gmail')}
            value={action.connection_id || ''}
            options={targets}
            change={([connection_id]) => change({ ...action, connection_id })}
          />
          <ConnectAccount
            provider='gmail'
            workspace={workspace}
            connected={(connection_id) => {
              change({ ...action, connection_id });
              setRetry((n) => n + 1);
            }}
          />
          {(action.type === 'addressed_email' ? (['to', 'cc', 'bcc'] as const) : (['to'] as const)).map((group) => {
            const values = action[group] ?? [];
            const label =
              action.type === 'addressed_email' ? t(`databaseAutomation.${group}`) : t('databaseAutomation.recipient');
            return (
              <div key={group}>
                {values.map((value, i) => (
                  <div key={i}>
                    <TextFields
                      label={label}
                      value={value}
                      fields={fields}
                      previous={previous}
                      change={(next) => change({ ...action, [group]: values.map((v, n) => (i === n ? next : v)) })}
                    />
                    <Button
                      type='button'
                      variant='ghost'
                      onClick={() => change({ ...action, [group]: values.filter((_, n) => i !== n) })}
                    >
                      {t('databaseAutomation.removeRecipient')}
                    </Button>
                  </div>
                ))}
                {(action.to?.length ?? 0) + (action.cc?.length ?? 0) + (action.bcc?.length ?? 0) < 10 && (
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() => change({ ...action, [group]: [...values, ''] })}
                  >
                    {action.type === 'addressed_email'
                      ? t('databaseAutomation.addAddress', { group: label })
                      : t('databaseAutomation.addRecipient')}
                  </Button>
                )}
              </div>
            );
          })}
          {action.type === 'addressed_email' &&
            (['reply_to', 'sender_name'] as const).map((key) => (
              <TextFields
                key={key}
                label={t(`databaseAutomation.${key}`)}
                value={action[key]}
                previous={previous}
                fields={fields}
                change={(value) => change({ ...action, [key]: value || undefined })}
              />
            ))}
          <TextFields
            label={t('databaseAutomation.subject')}
            value={action.subject}
            fields={fields}
            previous={previous}
            change={(subject) => change({ ...action, subject })}
          />
        </>
      )}
      {action.type === 'email' && (
        <>
          <Select
            label={t('databaseAutomation.people')}
            value={action.recipient_id || ''}
            options={users.map((u) => ({ id: u.person_id, name: u.name || u.email }))}
            change={([recipient_id]) => change({ ...action, recipient_id })}
          />
          <TextFields
            label={t('databaseAutomation.subject')}
            value={action.subject}
            fields={fields}
            previous={previous}
            change={(subject) => change({ ...action, subject })}
          />
        </>
      )}
      <TextFields
        label={t('databaseAutomation.message')}
        value={action.message}
        fields={fields}
        previous={previous}
        change={(message) => change({ ...action, message })}
      />
    </>
  );
}
