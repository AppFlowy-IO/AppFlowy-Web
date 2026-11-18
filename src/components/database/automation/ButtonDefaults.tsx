import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabase, useDatabaseContextOptional, useFieldSelector } from '@/application/database-yjs';
import { FieldType } from '@/application/database-yjs/database.type';
import { useUpdateButtonTypeOption } from '@/application/database-yjs/dispatch';
import { getTypeOptions } from '@/application/database-yjs/fields/type_option';
import { ruleApi, DatabaseRule } from '@/application/services/js-services/http/automation-api';
import { YjsDatabaseKey } from '@/application/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { Select } from './Select';
import { useAutomationCapabilities } from './useAutomationCapabilities';

export function ButtonDefaults({ fieldId }: { fieldId: string }) {
  const { t } = useTranslation();
  const caps = useAutomationCapabilities();
  const db = useDatabase();
  const context = useDatabaseContextOptional();
  const { field } = useFieldSelector(fieldId);
  const update = useUpdateButtonTypeOption(fieldId);
  const workspace = context?.workspaceId;
  const database = db?.get(YjsDatabaseKey.id);
  const available =
    caps.enabled &&
    caps.triggers.includes('button') &&
    !context?.readOnly &&
    context?.canWrite !== false &&
    !context?.dataSource;
  const options = field && getTypeOptions(field, FieldType.Button)?.toJSON();
  const [label, setLabel] = useState(typeof options?.label === 'string' ? options.label : '');
  const [id, setId] = useState(typeof options?.automation_id === 'string' ? options.automation_id : '');
  const [rules, setRules] = useState<DatabaseRule[]>();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!available || !workspace || !database) return;
    const ac = new AbortController();

    setRules(undefined);
    setFailed(false);
    void ruleApi
      .list(workspace, database, ac.signal)
      .then((page) => {
        if (!ac.signal.aborted)
          setRules(page.items.filter((r) => r.trigger.type === 'button' && r.trigger.field_id === fieldId));
      })
      .catch(() => {
        if (!ac.signal.aborted) setFailed(true);
      });
    return () => ac.abort();
  }, [available, workspace, database, fieldId, retry]);
  if (!available) return null;
  return (
    <div className='flex flex-col gap-2 p-2' onKeyDown={(e) => e.stopPropagation()}>
      <label>
        {t('databaseAutomation.buttonLabel')}
        <Input value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <Select
        label={t('databaseAutomation.buttonDefault')}
        value={id}
        options={[
          ...(id && !rules?.some((r) => r.id === id) ? [{ id, name: id }] : []),
          ...(rules || []).map((r) => ({ id: r.id, name: r.name })),
        ]}
        change={([v]) => setId(v || '')}
      />
      {failed && (
        <Button variant='ghost' onClick={() => setRetry((n) => n + 1)}>
          {t('databaseAutomation.retry')}
        </Button>
      )}
      <Button
        disabled={!rules || [...label.trim()].length > 128}
        onClick={() => update({ label: label.trim(), automation_id: id })}
      >
        {t('databaseAutomation.save')}
      </Button>
    </div>
  );
}
