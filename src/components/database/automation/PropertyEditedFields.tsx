import { useTranslation } from 'react-i18next';

import { RuleTrigger } from '@/application/services/js-services/http/automation-api';
import { Input } from '@/components/ui/input';

import { RuleField } from './model';
import { propertyIdentityIds, propertyOperand, propertyOperators, supportsPropertyEvent } from './property-trigger';
import { Item, Select } from './Select';
import { IdentityValue } from './WorkflowFields';

export function PropertyEditedFields({
  trigger,
  fields,
  choices,
  change,
}: {
  trigger: RuleTrigger;
  fields: RuleField[];
  choices: Item[];
  change: (trigger: RuleTrigger) => void;
}) {
  const { t } = useTranslation();
  const operators = propertyOperators(trigger.ty, t);
  const operand = propertyOperand(trigger.ty, trigger.condition);
  const content = trigger.content ?? '';

  return (
    <>
      <Select
        label={t('databaseAutomation.property')}
        value={trigger.field_id || ''}
        options={fields.filter((f) => supportsPropertyEvent(f.type))}
        change={([id]) => {
          const field = fields.find((f) => f.id === id);

          if (field)
            change({
              type: 'property_edited',
              field_id: id,
              ty: field.type,
              condition: propertyOperators(field.type, t)[0].value,
              content: '',
            });
        }}
      />
      {operators.length > 0 && (
        <Select
          label={t('databaseAutomation.operator')}
          value={String(trigger.condition)}
          options={operators.map((o) => ({ id: String(o.value), name: o.text }))}
          change={([id]) => {
            if (id) change({ ...trigger, condition: Number(id), content: '' });
          }}
        />
      )}
      {(operand === 'text' || operand === 'number') && (
        <label>
          {t('databaseAutomation.value')}
          <Input
            type={operand === 'number' ? 'number' : 'text'}
            value={content}
            onChange={(e) => change({ ...trigger, content: e.target.value })}
          />
        </label>
      )}
      {operand === 'options' && (
        <Select
          label={t('databaseAutomation.value')}
          multiple
          value={content.split(',').filter(Boolean)}
          options={choices}
          change={(ids) => change({ ...trigger, content: ids.join(',') })}
        />
      )}
      {(operand === 'person' || operand === 'relation') && (
        <IdentityValue
          key={trigger.field_id + '/' + trigger.condition}
          definition
          value={{ kind: operand, value: propertyIdentityIds(content) }}
          change={(v) => change({ ...trigger, content: JSON.stringify(v.value) })}
        />
      )}
    </>
  );
}
