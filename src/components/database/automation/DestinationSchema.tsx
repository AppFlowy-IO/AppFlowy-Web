import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, useSelectFieldOptions } from '@/application/database-yjs';
import {
  ruleApi,
  type PropertyValue,
  type TargetDatabase,
  type TargetField,
} from '@/application/services/js-services/http/automation-api';
import { Button } from '@/components/ui/button';

import type { RuleField } from './model';
import { Select } from './Select';

export function useDestinationSchema(workspace: string, database?: string) {
  const [dbs, setDbs] = useState<TargetDatabase[]>([]);
  const [more, setMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loaded, setLoaded] = useState<{ database: string; fields: TargetField[] }>();
  const [err, setErr] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const ac = new AbortController();

    ruleApi
      .databases(workspace, offset, ac.signal)
      .then((p) => {
        if (!ac.signal.aborted) {
          setDbs((old) => [...old.slice(0, offset), ...p.databases]);
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

    setLoaded(undefined);
    if (database)
      ruleApi
        .fields(workspace, database, ac.signal)
        .then((f) => {
          if (!ac.signal.aborted) setLoaded({ database, fields: f });
        })
        .catch(() => {
          if (!ac.signal.aborted) setErr(true);
        });
    return () => ac.abort();
  }, [workspace, database, retry]);

  return {
    dbs,
    fields: loaded?.database === database ? loaded?.fields ?? [] : [],
    more,
    err,
    loadMore: () => setOffset(dbs.length),
    retry: () => {
      setErr(false);
      setRetry((n) => n + 1);
    },
  };
}

export function DatabasePicker({
  schema,
  value,
  change,
  source,
}: {
  schema: ReturnType<typeof useDestinationSchema>;
  value: string;
  change: (id: string) => void;
  source?: string;
}) {
  const { t } = useTranslation();
  const options = schema.dbs.map((d) => ({ id: d.database_id, name: d.views[0]?.name || d.database_id }));

  if (source && !options.some((d) => d.id === source))
    options.unshift({ id: source, name: t('grid.relation.thisDatabase') });
  return (
    <>
      <Select
        label={t('databaseAutomation.targetDatabase')}
        value={value}
        options={options}
        change={([id]) => change(id)}
      />
      {schema.more && (
        <Button type='button' variant='ghost' onClick={schema.loadMore}>
          {t('databaseAutomation.more')}
        </Button>
      )}
      {schema.err && (
        <Button type='button' variant='ghost' onClick={schema.retry}>
          {t('databaseAutomation.retry')}
        </Button>
      )}
    </>
  );
}

/** Only stable option IDs are stored. A catalog choice is local to this edit and never rewrites the saved value. */
export function VariableSelectOptions({
  workspace,
  source,
  fields,
  value,
  change,
}: {
  workspace: string;
  source: string;
  fields: RuleField[];
  value: PropertyValue;
  change: (value: PropertyValue) => void;
}) {
  const { t } = useTranslation();
  const [database, chooseDatabase] = useState('');
  const [property, chooseProperty] = useState('');
  const local = database === source;
  const schema = useDestinationSchema(workspace, database && !local ? database : undefined);
  const sourceOptions = useSelectFieldOptions(local ? property : '');
  const type = value.kind === 'single_select' ? FieldType.SingleSelect : FieldType.MultiSelect;
  const properties: { id: string; name: string }[] = local
    ? fields.filter((field) => field.type === type)
    : schema.fields.filter((field) => field.field_type_id === type);
  const selected = properties.find((field) => field.id === property);
  const options = !selected
    ? []
    : local
    ? sourceOptions
    : schema.fields.find((field) => field.id === property)?.type_option?.content?.options ?? [];
  const multi = type === FieldType.MultiSelect;
  const saved = Array.isArray(value.value)
    ? value.value
    : typeof value.value === 'string' && value.value
    ? [value.value]
    : [];

  return (
    <>
      <DatabasePicker
        schema={schema}
        source={source}
        value={database}
        change={(id) => {
          chooseDatabase(id);
          chooseProperty('');
        }}
      />
      {database && (
        <Select
          label={t('databaseAutomation.property')}
          value={property}
          options={properties}
          change={([id]) => chooseProperty(id)}
        />
      )}
      {value.kind === 'multi_select_delta' && (
        <Select
          label={t('databaseAutomation.operator')}
          value={value.operation || 'replace'}
          options={(['replace', 'add', 'remove'] as const).map((id) => ({
            id,
            name: t(`databaseAutomation.kinds.${id}`),
          }))}
          change={([operation]) =>
            change(
              operation === 'add' || operation === 'remove'
                ? { ...value, operation }
                : { kind: 'multi_select', value: saved }
            )
          }
        />
      )}
      {saved.length > 0 && <output aria-label={t('databaseAutomation.value')}>{saved.join(', ')}</output>}
      {selected && (
        <Select
          label={t('databaseAutomation.option')}
          value={multi ? saved : saved[0] || ''}
          multiple={multi}
          options={options}
          change={(ids) => change({ ...value, value: multi ? ids : ids[0] || '' })}
        />
      )}
    </>
  );
}
