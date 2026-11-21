import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { v4 as uuid } from 'uuid';

import { FieldType, useDatabaseFields } from '@/application/database-yjs';
import {
  createDetachedFilter,
  DetachedFilterStoreContext,
  parseDetachedFilter,
  updateDetachedFilters,
} from '@/application/database-yjs/dispatch/detached-filters';
import { DatabaseConditionsContext } from '@/components/database/components/conditions/context';
import { FilterChip } from '@/components/database/components/filters/Filter';
import {
  checkboxFilterConditions,
  checklistFilterConditions,
  multiSelectFilterConditions,
  numberFilterConditions,
  singleSelectFilterConditions,
  textFilterConditions,
} from '@/components/database/components/filters/filter-conditions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { RuleField } from './model';
import { Item, Select } from './Select';

type Condition = Record<string, unknown>;
type Field = RuleField & { options?: Item[] };
type Props = { conditions: unknown[]; fields: Field[]; source: boolean; change: (v: unknown[]) => void };
const object = (value: unknown): value is Condition => !!value && typeof value === 'object' && !Array.isArray(value);

function targetOperators(type: FieldType) {
  switch (type) {
    case FieldType.RichText:
    case FieldType.URL:
      return textFilterConditions;
    case FieldType.Number:
      return numberFilterConditions;
    case FieldType.SingleSelect:
      return singleSelectFilterConditions;
    case FieldType.MultiSelect:
      return multiSelectFilterConditions;
    case FieldType.Checkbox:
      return checkboxFilterConditions;
    case FieldType.Checklist:
      return checklistFilterConditions;
    default:
      return undefined;
  }
}

function TargetCondition({ node, field, change }: { node: Condition; field: Field; change: (c: Condition) => void }) {
  const { t } = useTranslation();
  const op = Number(node.condition);
  const options = targetOperators(field.type)?.(t) || [];
  const select = field.type === FieldType.SingleSelect || field.type === FieldType.MultiSelect;
  const noValue =
    field.type === FieldType.Checkbox || field.type === FieldType.Checklist || (select ? op >= 4 : op >= 6);

  return (
    <>
      <Select
        label={field.name}
        value={String(op)}
        options={options.map((o) => ({ id: String(o.value), name: o.text }))}
        change={([selected]) => change({ ...node, condition: Number(selected), content: '' })}
      />
      {!noValue &&
        (select ? (
          <Select
            label={t('databaseAutomation.value')}
            multiple
            value={String(node.content || '')
              .split(',')
              .filter(Boolean)}
            options={field.options || []}
            change={(ids) => change({ ...node, content: ids.join(',') })}
          />
        ) : (
          <label>
            {t('databaseAutomation.value')}
            <Input
              type={field.type === FieldType.Number ? 'number' : 'text'}
              value={String(node.content ?? '')}
              onChange={(e) => change({ ...node, content: e.target.value })}
            />
          </label>
        ))}
    </>
  );
}

function SourceCondition({
  node,
  change,
  remove,
}: {
  node: Condition;
  change: (c: Condition) => void;
  remove: () => void;
}) {
  const schema = useDatabaseFields();
  const [open, setOpen] = useState<string>();
  const { t } = useTranslation();
  const parsed = schema && parseDetachedFilter(node, schema);

  if (!schema || !parsed) return <span>{t('databaseAutomation.unavailableCondition')}</span>;
  return (
    <DetachedFilterStoreContext.Provider
      value={{
        addFilter: () => undefined,
        updateFilter: (params) => change(updateDetachedFilters([node], schema, params)[0]),
        removeFilter: remove,
      }}
    >
      <DatabaseConditionsContext.Provider
        value={{
          expanded: true,
          toggleExpanded: () => undefined,
          setExpanded: () => undefined,
          isAdvancedMode: false,
          setAdvancedMode: () => undefined,
          openFilterId: open,
          setOpenFilterId: setOpen,
        }}
      >
        <FilterChip filter={parsed} />
      </DatabaseConditionsContext.Provider>
    </DetachedFilterStoreContext.Provider>
  );
}

export function ConditionFields({ conditions, fields, source, change }: Props) {
  const { t } = useTranslation();
  const schema = useDatabaseFields();
  const [choice, setChoice] = useState('');
  const offered = fields.filter((f) =>
    source ? schema && createDetachedFilter(f.id, schema, 'candidate') : targetOperators(f.type)
  );
  const selected = offered.find((f) => f.id === choice);
  const create = () =>
    selected
      ? source && schema
        ? createDetachedFilter(selected.id, schema)
        : {
            id: uuid(),
            filter_type: 2,
            ty: selected.type,
            field_id: selected.id,
            condition: targetOperators(selected.type)?.(t)[0]?.value ?? 0,
            content: '',
          }
      : undefined;
  const put = (i: number, v: unknown) => change(conditions.map((old, n) => (i === n ? v : old)));

  return (
    <div className='flex flex-col gap-2'>
      {conditions.map((node, i) => {
        const remove = () => change(conditions.filter((_, n) => n !== i));
        const group = object(node) && Array.isArray(node.children) && [0, 1].includes(Number(node.filter_type));
        const field = object(node) && fields.find((f) => f.id === node.field_id);

        return (
          <fieldset
            key={object(node) && typeof node.id === 'string' ? node.id : i}
            className='flex flex-col gap-2 rounded-300 border border-border-primary p-2'
          >
            {group && object(node) ? (
              <>
                <Select
                  label={t('databaseAutomation.group')}
                  value={String(node.filter_type)}
                  options={[
                    { id: '0', name: t('databaseAutomation.all') },
                    { id: '1', name: t('databaseAutomation.any') },
                  ]}
                  change={([v]) => put(i, { ...node, filter_type: Number(v) })}
                />
                <ConditionFields
                  conditions={node.children as unknown[]}
                  fields={fields}
                  source={source}
                  change={(children) => put(i, { ...node, children })}
                />
              </>
            ) : object(node) && source ? (
              <SourceCondition node={node} change={(c) => put(i, c)} remove={remove} />
            ) : object(node) && field && targetOperators(field.type) ? (
              <TargetCondition node={node} field={field} change={(c) => put(i, c)} />
            ) : (
              <span>{t('databaseAutomation.unavailableCondition')}</span>
            )}
            <Button variant='ghost' size='sm' type='button' onClick={remove}>
              {t('databaseAutomation.removeCondition')}
            </Button>
          </fieldset>
        );
      })}
      <Select
        label={t('databaseAutomation.conditionField')}
        value={choice}
        options={offered}
        change={([id]) => setChoice(id)}
      />
      <div className='flex gap-2'>
        <Button
          type='button'
          size='sm'
          variant='outline'
          disabled={!selected}
          onClick={() => {
            const node = create();

            if (node) change([...conditions, node]);
          }}
        >
          {t('databaseAutomation.addCondition')}
        </Button>
        <Button
          type='button'
          size='sm'
          variant='outline'
          disabled={!selected}
          onClick={() => {
            const node = create();

            if (node) change([...conditions, { id: uuid(), filter_type: 1, children: [node] }]);
          }}
        >
          {t('databaseAutomation.addGroup')}
        </Button>
      </div>
    </div>
  );
}
