import { useTranslation } from 'react-i18next';

import type { AutomationText, RuleAction, TextPart } from '@/application/services/js-services/http/automation-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import type { RuleField } from './model';
import { Select } from './Select';

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
