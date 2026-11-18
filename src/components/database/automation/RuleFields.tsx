import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import {
  FieldType,
  useSelectFieldOptions,
  useDatabaseContext,
  useDatabaseViewsSelector,
} from '@/application/database-yjs';
import type { PropertyValue, RuleAction, RuleTrigger } from '@/application/services/js-services/http/automation-api';
import { YjsDatabaseKey } from '@/application/types';
import { useMentionableUsers } from '@/components/database/components/cell/person/useMentionableUsers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { Capabilities, newAction, RuleField, valueKinds } from './model';
import { PropertyEditedFields } from './PropertyEditedFields';
import { SourceValue, WorkflowFields } from './WorkflowFields';
import { TextFields } from './TextFields';

import type { ReactNode } from 'react';

const selectClass =
  'w-full rounded-300 border border-border-primary bg-surface-primary px-2 py-1 text-sm text-text-primary';
const selected = (element: HTMLSelectElement) => Array.from(element.selectedOptions, (opt) => opt.value);

function Choice({
  label,
  value,
  onChange,
  children,
  multiple = false,
}: {
  label: string;
  value: string | string[];
  onChange: (values: string[]) => void;
  children: ReactNode;
  multiple?: boolean;
}) {
  return (
    <label className='flex flex-col gap-1 text-sm text-text-secondary'>
      {label}
      <select
        aria-label={label}
        className={selectClass}
        multiple={multiple}
        value={value}
        onChange={(e) => onChange(selected(e.currentTarget))}
      >
        {children}
      </select>
    </label>
  );
}

export function TriggerFields({
  trigger,
  fields,
  caps,
  onChange,
}: {
  trigger: RuleTrigger;
  fields: RuleField[];
  caps: Capabilities;
  onChange: (trigger: RuleTrigger) => void;
}) {
  const { t } = useTranslation();
  const options = useSelectFieldOptions(trigger.field_id || '');

  return (
    <>
      <Choice
        label={t('databaseAutomation.trigger')}
        value={trigger.type}
        onChange={([type]) =>
          onChange(
            type === 'row_events'
              ? {
                  type,
                  match: 'any',
                  triggers: [
                    {
                      type:
                        caps.triggers.find((t) => !['manual', 'scheduled', 'row_events', 'button'].includes(t)) ||
                        'row_created',
                    },
                  ],
                }
              : { type }
          )
        }
      >
        {caps.triggers.map((type) => (
          <option key={type} value={type}>
            {t(`databaseAutomation.kinds.${type}`, { defaultValue: type })}
          </option>
        ))}
      </Choice>
      {trigger.type === 'button' && (
        <Choice
          label={t('databaseAutomation.buttonProperty')}
          value={trigger.field_id || ''}
          onChange={([field_id]) => onChange({ type: 'button', field_id })}
        >
          <option value=''>{t('databaseAutomation.chooseProperty')}</option>
          {fields
            .filter((f) => f.type === FieldType.Button)
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
        </Choice>
      )}
      {trigger.type === 'row_events' && <EventGroup {...{ trigger, fields, caps, onChange }} />}
      {trigger.type === 'property_edited' && (
        <PropertyEditedFields trigger={trigger} fields={fields} choices={options} change={onChange} />
      )}
      {trigger.type === 'status_set_to' && (
        <>
          <Choice
            label={t('databaseAutomation.property')}
            value={trigger.field_id || ''}
            onChange={([id]) => onChange({ type: trigger.type, field_id: id })}
          >
            <option value=''>{t('databaseAutomation.chooseProperty')}</option>
            {fields
              .filter((f) => f.type === FieldType.SingleSelect)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </Choice>
          <Choice
            label={t('databaseAutomation.option')}
            value={trigger.option_id || ''}
            onChange={([id]) => onChange({ ...trigger, option_id: id })}
          >
            <option value=''>{t('databaseAutomation.chooseOption')}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Choice>
        </>
      )}
      {['row_updated', 'row_created_or_updated'].includes(trigger.type) && (
        <Choice
          multiple
          label={t('databaseAutomation.watchFields')}
          value={trigger.field_ids || []}
          onChange={(ids) => onChange({ type: trigger.type, field_ids: ids })}
        >
          {fields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Choice>
      )}
    </>
  );
}

function EventGroup({
  trigger,
  fields,
  caps,
  onChange,
}: {
  trigger: RuleTrigger;
  fields: RuleField[];
  caps: Capabilities;
  onChange: (v: RuleTrigger) => void;
}) {
  const { t } = useTranslation();
  const { databasePageId } = useDatabaseContext();
  const { viewIds, childViews } = useDatabaseViewsSelector(databasePageId || '');
  const children = trigger.triggers || [];
  const events = [
    ...caps.triggers.filter((id) => !['row_events', 'manual', 'scheduled', 'button'].includes(id)),
    ...(caps.propertyEdited ? ['property_edited'] : []),
  ];

  return (
    <fieldset className='flex flex-col gap-2'>
      <Choice
        label={t('databaseAutomation.group')}
        value={trigger.match || 'any'}
        onChange={([v]) => onChange({ ...trigger, match: v === 'all' ? 'all' : 'any' })}
      >
        <option value='any'>{t('databaseAutomation.any')}</option>
        <option value='all'>{t('databaseAutomation.all')}</option>
      </Choice>
      <Choice
        label={t('databaseAutomation.view')}
        value={trigger.view_id || ''}
        onChange={([view_id]) => onChange({ ...trigger, view_id: view_id || undefined })}
      >
        <option value=''>{t('databaseAutomation.entireDatabase')}</option>
        {viewIds.map((id, i) => (
          <option key={id} value={id}>
            {childViews[i]?.get(YjsDatabaseKey.name) || id}
          </option>
        ))}
      </Choice>
      {children.map((child, i) => (
        <div key={i}>
          <TriggerFields
            trigger={child}
            fields={fields}
            caps={{ ...caps, triggers: events }}
            onChange={(v) => onChange({ ...trigger, triggers: children.map((c, n) => (i === n ? v : c)) })}
          />
          <Button
            variant='ghost'
            size='sm'
            type='button'
            disabled={children.length < 2}
            onClick={() => onChange({ ...trigger, triggers: children.filter((_, n) => i !== n) })}
          >
            {t('databaseAutomation.removeTrigger')}
          </Button>
        </div>
      ))}
      <Button
        variant='outline'
        type='button'
        onClick={() => onChange({ ...trigger, triggers: [...children, { type: events[0] }] })}
      >
        {t('databaseAutomation.addTrigger')}
      </Button>
    </fieldset>
  );
}

function NotifyFields({
  action,
  fields,
  deleted,
  extended,
  previous,
  change,
}: {
  action: RuleAction;
  fields: RuleField[];
  deleted: boolean;
  extended: boolean;
  previous: RuleAction[];
  change: (a: RuleAction) => void;
}) {
  const { t } = useTranslation();
  const { users, fetchUsers } = useMentionableUsers();

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);
  return (
    <>
      <label className='flex items-center gap-2'>
        <input
          type='checkbox'
          checked={!!action.notify_actor}
          onChange={(e) => change({ ...action, notify_actor: e.target.checked })}
        />
        {t('databaseAutomation.notifyActor')}
      </label>
      <Choice
        multiple
        label={t('databaseAutomation.people')}
        value={action.user_ids || []}
        onChange={(user_ids) => change({ ...action, user_ids })}
      >
        {(action.user_ids || [])
          .filter((id) => !users.some((p) => p.person_id === id))
          .map((id) => (
            <option value={id} key={id}>
              {id}
            </option>
          ))}
        {users.map((p) => (
          <option key={p.person_id} value={p.person_id}>
            {p.name || p.email}
          </option>
        ))}
      </Choice>
      {!deleted && (
        <Choice
          multiple
          label={t('databaseAutomation.peopleFields')}
          value={action.person_field_ids || []}
          onChange={(person_field_ids) => change({ ...action, person_field_ids })}
        >
          {fields
            .filter((f) => [FieldType.Person, FieldType.CreatedBy, FieldType.LastEditedBy].includes(f.type))
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
        </Choice>
      )}
      {extended ? (
        <TextFields
          label={t('databaseAutomation.message')}
          fields={deleted ? [] : fields}
          previous={previous}
          value={action.message_template ?? action.message}
          change={(value) => {
            const next = { ...action };

            delete next.message_template;
            delete next.message;
            if (typeof value === 'string') {
              if (value) next.message = value;
            } else {
              next.message_template = value;
            }

            change(next);
          }}
        />
      ) : (
        <label>
          {t('databaseAutomation.message')}
          <Input
            maxLength={500}
            value={typeof action.message === 'string' ? action.message : ''}
            onChange={(e) => change({ ...action, message: e.target.value })}
          />
        </label>
      )}
    </>
  );
}

function initialValue(kind: string): PropertyValue {
  if (kind === 'event_time') return { kind };
  if (['multi_select', 'person', 'relation'].includes(kind)) return { kind, value: [] };
  if (kind === 'checkbox') return { kind, value: false };
  if (kind === 'number') return { kind };
  return { kind, value: '' };
}

function PropertyFields({
  expressionFields,
  extended,
  previous,
  action,
  fields,
  change,
}: {
  action: RuleAction;
  fields: RuleField[];
  change: (a: RuleAction) => void;
  extended: boolean;
  expressionFields?: RuleField[];
  previous: RuleAction[];
}) {
  const { t } = useTranslation();
  const options = useSelectFieldOptions(action.field_id || '');
  const field = fields.find((f) => f.id === action.field_id);
  const kinds = valueKinds(field?.type);
  const current = action.value;
  const set = (value: PropertyValue) => change({ ...action, value });

  return (
    <>
      <Choice
        label={t('databaseAutomation.property')}
        value={field?.id || ''}
        onChange={([id]) => {
          const kind = valueKinds(fields.find((f) => f.id === id)?.type)[0];

          change({ type: 'set_property', field_id: id, value: initialValue(kind) });
        }}
      >
        <option value=''>{t('databaseAutomation.chooseProperty')}</option>
        {fields
          .filter(
            (f) => valueKinds(f.type).length && (extended || ![FieldType.Person, FieldType.Relation].includes(f.type))
          )
          .map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
      </Choice>
      {field && current && (
        <SourceValue
          fields={fields}
          previous={previous}
          literals={kinds}
          options={options}
          value={current}
          change={set}
          expressionFields={expressionFields}
          extended={extended}
        />
      )}
    </>
  );
}

export function ActionFields({
  workspace,
  previous,
  action,
  fields,
  deleted,
  expressionRow,
  scheduled,
  caps,
  change,
}: {
  action: RuleAction;
  fields: RuleField[];
  deleted: boolean;
  expressionRow: boolean;
  scheduled: boolean;
  caps: Capabilities;
  workspace: string;
  previous: RuleAction[];
  change: (a: RuleAction) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <Choice label={t('databaseAutomation.action')} value={action.type} onChange={([type]) => change(newAction(type))}>
        {caps.actions
          .filter((a) => !deleted || a !== 'set_property')
          .map((a) => (
            <option key={a} value={a}>
              {t(`databaseAutomation.kinds.${a}`, { defaultValue: a })}
            </option>
          ))}
      </Choice>
      {action.type === 'notify' ? (
        <NotifyFields
          action={action}
          fields={expressionRow ? fields : []}
          deleted={deleted}
          change={change}
          previous={previous}
          extended={caps.actions.includes('define_variable')}
        />
      ) : action.type === 'set_property' ? (
        <PropertyFields
          expressionFields={caps.formulaExpression ? (expressionRow ? fields : []) : undefined}
          action={action}
          fields={fields}
          change={change}
          previous={previous}
          extended={caps.actions.includes('define_variable')}
        />
      ) : (
        <WorkflowFields
          scheduled={scheduled}
          hasRow={expressionRow}
          expressionFields={caps.formulaExpression ? (expressionRow ? fields : []) : undefined}
          webhookHeaders={caps.webhookHeaders}
          {...{ workspace, action, previous, change }}
          fields={expressionRow ? fields : []}
          extended={caps.actions.includes('define_variable')}
        />
      )}
    </>
  );
}
