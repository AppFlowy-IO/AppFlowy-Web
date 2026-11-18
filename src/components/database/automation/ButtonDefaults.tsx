import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { readButtonOpenTarget, validButtonText, type ButtonOpenTarget } from '@/application/automation/button';
import { useDatabase, useDatabaseContextOptional, useFieldSelector } from '@/application/database-yjs';
import { FieldType } from '@/application/database-yjs/database.type';
import { useUpdateButtonTypeOption } from '@/application/database-yjs/dispatch';
import { getTypeOptions } from '@/application/database-yjs/fields/type_option';
import { ruleApi, DatabaseRule } from '@/application/services/js-services/http/automation-api';
import { YjsDatabaseKey } from '@/application/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseAppFlowyPageLink } from '@/utils/url';

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
  const [savedConfirmation, setSavedConfirmation] = useState(
    typeof options?.confirmation === 'string' ? options.confirmation : ''
  );
  const [confirmation, setConfirmation] = useState(savedConfirmation);
  const [savedTarget, setSavedTarget] = useState<ButtonOpenTarget | undefined>(() =>
    readButtonOpenTarget(options?.open_target)
  );
  const [target, setTarget] = useState(savedTarget);
  const futureTarget =
    options?.open_target !== undefined && options?.open_target !== null && !readButtonOpenTarget(options.open_target);
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
  const selectedRule = rules?.find((rule) => rule.id === id);
  const steps = selectedRule
    ? selectedRule.actions.flatMap((action, i) => (action.type === 'create_row' ? [i] : []))
    : [0, 1, 2, 3, 4];
  const validTarget =
    !target ||
    (!!readButtonOpenTarget(target) && (target.type !== 'created_row' || steps.includes(target.action_index)));

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
      {caps.buttonInteractions && (
        <>
          <label>
            {t('databaseAutomation.confirmation')}
            <Input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
          </label>
          {futureTarget ? (
            <p>{t('databaseAutomation.targetUnavailable')}</p>
          ) : (
            <>
              <Select
                label={t('databaseAutomation.afterSuccess')}
                value={target?.type || ''}
                options={(['url', 'page', 'created_row'] as const).map((id) => ({
                  id,
                  name: t(`databaseAutomation.openKind.${id}`),
                }))}
                change={([v]) =>
                  setTarget(
                    v === 'page'
                      ? { type: 'page', view_id: '' }
                      : v === 'url'
                      ? { type: 'url', url: '' }
                      : v === 'created_row'
                      ? { type: 'created_row', action_index: -1 }
                      : undefined
                  )
                }
              />
              {target?.type === 'url' && (
                <label>
                  {t('databaseAutomation.openKind.url')}
                  <Input type='url' value={target.url} onChange={(e) => setTarget({ ...target, url: e.target.value })} />
                </label>
              )}
              {target?.type === 'page' && (
                <label>
                  {t('databaseAutomation.pageId')}
                  <Input
                    value={target.view_id}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      const page = parseAppFlowyPageLink(raw, window.location.hostname);

                      setTarget({
                        ...target,
                        view_id:
                          page?.workspaceId === workspace && !page?.rowId
                            ? page?.databaseViewId || page?.viewId || raw
                            : raw,
                      });
                    }}
                  />
                </label>
              )}
              {target?.type === 'created_row' && (
                <Select
                  label={t('databaseAutomation.createdStep')}
                  value={target.action_index < 0 ? '' : String(target.action_index)}
                  options={steps.map((i) => ({
                    id: String(i),
                    name: t('databaseAutomation.step', { n: i + 1 }),
                  }))}
                  change={([v]) => setTarget({ ...target, action_index: v ? Number(v) : -1 })}
                />
              )}
            </>
          )}
        </>
      )}
      {failed && (
        <Button variant='ghost' onClick={() => setRetry((n) => n + 1)}>
          {t('databaseAutomation.retry')}
        </Button>
      )}
      <Button
        disabled={
          !rules ||
          !validButtonText(label, 128) ||
          (caps.buttonInteractions && (!validButtonText(confirmation, 256) || !validTarget))
        }
        onClick={() => {
          update({
            label: label.trim(),
            automation_id: id,
            ...(caps.buttonInteractions && {
              ...(confirmation.trim() !== savedConfirmation && { confirmation: confirmation.trim() }),
              ...(!futureTarget &&
                JSON.stringify(target) !== JSON.stringify(savedTarget) && {
                  open_target: target || null,
                }),
            }),
          });
          setSavedConfirmation(confirmation.trim());
          setSavedTarget(target);
        }}
      >
        {t('databaseAutomation.save')}
      </Button>
    </div>
  );
}
