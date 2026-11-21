import { useContext } from 'react';
import { useTranslation } from 'react-i18next';

import type { AutomationText, RuleAction, TextPart } from '@/application/services/js-services/http/automation-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { ExpressionFields } from './ExpressionFields';
import { type RuleField, valueKinds } from './model';
import { RichActionContext, MentionChoice } from './RichActionText';
import { Select } from './Select';

export function TextFields({
  label,
  value,
  fields,
  previous,
  allowRich = true,
  change,
}: {
  label: string;
  allowRich?: boolean;
  value?: AutomationText;
  fields: RuleField[];
  previous: RuleAction[];
  change: (v: AutomationText) => void;
}) {
  const { t } = useTranslation();
  const options = useContext(RichActionContext);
  const rich = allowRich && options.rich;

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
  const readable = fields.filter((field) => valueKinds(field.type).length > 0);
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
              ...(rich ? ['expression', 'date', 'page', 'person', 'group'] : []),
              ...(readable.length ? ['field'] : []),
              ...(variables.length ? ['variable'] : []),
              ...(steps.length ? ['step_row_id'] : []),
            ].map((id) => ({ id, name: t(`databaseAutomation.kinds.${id}`, { defaultValue: id }) }))}
            change={([type]) => {
              if (type === 'expression') write(i, { type, expression: '' });
              else if (type === 'date') write(i, { type });
              else if (type === 'page') write(i, { type, view_id: '' });
              else if (type === 'group') write(i, { type, group_id: '' });
              else if (type === 'person') write(i, { type, user_id: '' });
              else if (type === 'field') write(i, { type, field_id: readable[0]?.id || '' });
              else if (type === 'variable') write(i, { type, name: variables[0]?.id || '' });
              else if (type === 'step_row_id') write(i, { type, action_index: Number(steps[0]?.id) });
              else write(i, { type: 'text', value: '' });
            }}
          />
          {p.type === 'expression' ? (
            <ExpressionFields
              source={p.expression}
              fields={fields}
              change={(expression) => write(i, { type: 'expression', expression })}
            />
          ) : p.type === 'date' ? (
            <label>
              {t('databaseAutomation.mentionDate')}
              <Input
                type='date'
                value={p.value || ''}
                onChange={(e) => write(i, e.target.value ? { type: 'date', value: e.target.value } : { type: 'date' })}
              />
            </label>
          ) : p.type === 'page' || p.type === 'group' || p.type === 'person' ? (
            <MentionChoice
              key={options.workspace + p.type}
              workspace={options.workspace}
              part={p}
              change={(part) => write(i, part)}
            />
          ) : p.type === 'text' ? (
            <Input
              aria-label={t('databaseAutomation.value')}
              value={p.value}
              onChange={(e) => write(i, { ...p, value: e.target.value })}
            />
          ) : (
            <Select
              label={t('databaseAutomation.value')}
              value={p.type === 'field' ? p.field_id : p.type === 'variable' ? p.name : String(p.action_index)}
              options={p.type === 'field' ? readable : p.type === 'variable' ? variables : steps}
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
