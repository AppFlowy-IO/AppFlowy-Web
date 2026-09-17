import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType } from '@/application/database-yjs/database.type';
import {
  FormulaBuiltinSpec,
  FormulaFieldSchema,
  FormulaFunctionExample,
  FormulaFunctionSpec,
  formulaPropertyReference,
  formulaTypeOfField,
  typeToString,
} from '@/application/database-yjs/fields/formula';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';
import { cn } from '@/lib/utils';

import { HIGHLIGHT_CLASS, highlightFormula } from './highlight';

export type FormulaDocsItem =
  | { kind: 'function'; spec: FormulaFunctionSpec }
  | { kind: 'property'; entry: FormulaFieldSchema }
  | { kind: 'builtin'; spec: FormulaBuiltinSpec };

function Snippet({ source }: { source: string }) {
  return (
    <code className={'whitespace-pre-wrap break-words font-mono text-xs'}>
      {highlightFormula(source).map((segment, index) => (
        <span key={index} className={HIGHLIGHT_CLASS[segment.kind]} data-highlight={segment.kind}>
          {segment.text}
        </span>
      ))}
    </code>
  );
}

function propertyExamples(entry: FormulaFieldSchema, schema: FormulaFieldSchema[]): FormulaFunctionExample[] {
  const ref = formulaPropertyReference(entry.id, schema);
  const type = entry.type === FieldType.Formula ? undefined : formulaTypeOfField(entry);

  if (entry.type === FieldType.Checklist) {
    return [
      { expression: ref, result: 'percent of items done' },
      { expression: `${ref} == 100`, result: 'true when every item is done' },
    ];
  }

  if (entry.type === FieldType.Time) {
    return [
      { expression: ref, result: 'the time in milliseconds' },
      { expression: `round(${ref} / 60000)`, result: 'the time in minutes' },
    ];
  }

  if (type === 'number') {
    return [
      { expression: ref, result: 'the number' },
      { expression: `${ref} * 2`, result: 'double the number' },
    ];
  }

  if (type === 'boolean') {
    return [{ expression: `if(${ref}, "Done", "Open")`, result: '"Done" when checked' }];
  }

  if (type === 'date') {
    return [
      { expression: `dateBetween(${ref}, now(), "days")`, result: 'days until the date' },
      { expression: `formatDate(${ref}, "MMM D")`, result: '"Mar 1"' },
    ];
  }

  if (type !== undefined && typeof type !== 'string') {
    return [
      { expression: `${ref}.length()`, result: 'number of items' },
      { expression: `${ref}.join(", ")`, result: 'items as text' },
    ];
  }

  return [
    { expression: ref, result: 'the value' },
    { expression: `${ref}.length()`, result: 'number of characters' },
  ];
}

function FormulaDocsPanelContent({
  item,
  schema,
  onInsert,
}: {
  item: FormulaDocsItem | null;
  schema: FormulaFieldSchema[];
  onInsert: (text: string) => void;
}) {
  const { t } = useTranslation();

  if (!item) {
    return <div className={'hidden md:block'} data-testid={'formula-docs'} />;
  }

  let title: React.ReactNode;
  let signature: string;
  let description: string;
  let examples: FormulaFunctionExample[];

  switch (item.kind) {
    case 'function':
      title = <span className={'font-mono'}>{item.spec.name}()</span>;
      signature = item.spec.signature;
      description = item.spec.description;
      examples = item.spec.examples;
      break;
    case 'builtin':
      title = <span className={'font-mono'}>{item.spec.name}</span>;
      signature = item.spec.signature;
      description = item.spec.description;
      examples = item.spec.examples;
      break;
    case 'property': {
      const type =
        item.entry.type === FieldType.Formula ? 'formula' : typeToString(formulaTypeOfField(item.entry));

      title = (
        <span className={'flex items-center gap-2'}>
          <FieldTypeIcon type={item.entry.type} className={'h-4 w-4 text-icon-secondary'} />
          <span className={'truncate'}>{item.entry.name}</span>
        </span>
      );
      signature = formulaPropertyReference(item.entry.id, schema);
      description = t('grid.formula.propertyDescription', {
        defaultValue: 'Property of type {{type}}.',
        type,
        // React escapes the text; i18next escaping would show "list&lt;text&gt;".
        interpolation: { escapeValue: false },
      });
      examples = propertyExamples(item.entry, schema);
      break;
    }
  }

  return (
    <div className={'flex min-h-0 flex-col gap-2 overflow-y-auto text-sm'} data-testid={'formula-docs'}>
      <div className={'text-base font-medium text-text-primary'}>{title}</div>
      <div className={'font-mono text-xs text-text-secondary'}>{signature}</div>
      <p className={'text-text-secondary'}>{description}</p>
      <div className={'flex flex-col gap-1'}>
        {examples.map((example) => (
          <button
            key={example.expression}
            type={'button'}
            title={t('grid.formula.insertExample', { defaultValue: 'Insert this example' })}
            className={cn(
              'flex flex-col items-start gap-0.5 rounded-300 border border-border-primary px-2 py-1.5 text-left hover:bg-fill-content-hover'
            )}
            onClick={() => onInsert(example.expression)}
          >
            <Snippet source={example.expression} />
            <span className={'font-mono text-xs text-text-tertiary'}>= {example.result}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Memoized: the editor re-renders on every keystroke, the docs only when the item changes. */
export const FormulaDocsPanel = memo(FormulaDocsPanelContent);
