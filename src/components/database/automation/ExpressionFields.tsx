import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType } from '@/application/database-yjs/database.type';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';

import { Select } from './Select';

import type { RuleField } from './model';

const readable = new Set([FieldType.RichText, FieldType.Number, FieldType.Checkbox, FieldType.DateTime]);

export function ExpressionFields({
  source,
  fields,
  change,
}: {
  source: string;
  fields: RuleField[];
  change: (value: string) => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLTextAreaElement>(null);
  const properties = fields.filter((field) => readable.has(field.type));

  return (
    <>
      <label>
        {t('databaseAutomation.kinds.expression')}
        <TextareaAutosize
          ref={input}
          minRows={2}
          maxRows={6}
          spellCheck={false}
          value={source}
          onChange={(event) => change(event.target.value)}
        />
      </label>
      {properties.length > 0 && (
        <Select
          label={t('databaseAutomation.insertFormulaProperty')}
          options={properties}
          value=''
          change={([id]) => {
            if (!id || !input.current) return;
            const editor = input.current;
            const start = editor.selectionStart;
            const reference = `prop(${JSON.stringify(id)})`;

            change(source.slice(0, start) + reference + source.slice(editor.selectionEnd));
            requestAnimationFrame(() => {
              editor.focus();
              editor.setSelectionRange(start + reference.length, start + reference.length);
            });
          }}
        />
      )}
    </>
  );
}
