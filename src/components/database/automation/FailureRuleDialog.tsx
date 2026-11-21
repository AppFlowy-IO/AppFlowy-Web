import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInRouterContext, useSearchParams } from 'react-router-dom';

import { useDatabase, useDatabaseContext, useDatabaseView, usePropertiesSelector } from '@/application/database-yjs';
import { DatabaseRule, ruleApi } from '@/application/services/js-services/http/automation-api';
import { YjsDatabaseKey } from '@/application/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { failureRuleFromSearch, FailureRule } from './failure-link';
import { useEditorCapabilities } from './useAutomationCapabilities';

import type { Capabilities } from './model';

const RuleForm = lazy(() => import('./AutomationEditor').then((module) => ({ default: module.RuleForm })));

export function FailureRuleDialog() {
  const routed = useInRouterContext();

  return routed ? <RoutedFailureRule /> : null;
}

function RoutedFailureRule() {
  const [search, setSearch] = useSearchParams();
  const target = failureRuleFromSearch(search);

  if (!target) return null;
  const close = () =>
    setSearch(
      (current) => {
        const next = new URLSearchParams(current);

        for (const key of ['automationDatabase', 'automationId', 'automationRow']) next.delete(key);
        return next;
      },
      { replace: true }
    );

  return <CurrentDatabaseFailure target={target} close={close} />;
}

function CurrentDatabaseFailure({ target, close }: { target: FailureRule; close: () => void }) {
  const { workspaceId, dataSource } = useDatabaseContext();
  const database = useDatabase()?.get(YjsDatabaseKey.id);
  const { caps, waiting } = useEditorCapabilities();

  if (
    !workspaceId ||
    database !== target.database ||
    !caps.enabled ||
    (target.row && !caps.rowScoped) ||
    dataSource?.type === 'history'
  )
    return null;
  return (
    <EditableFailure
      key={[workspaceId, database, target.rule, target.row].join('/')}
      workspace={workspaceId}
      target={target}
      caps={caps}
      waiting={waiting}
      close={close}
    />
  );
}

function EditableFailure({
  workspace,
  target,
  caps,
  waiting,
  close,
}: {
  workspace: string;
  target: FailureRule;
  caps: Capabilities;
  waiting: boolean;
  close: () => void;
}) {
  const { t } = useTranslation();
  const { properties } = usePropertiesSelector(false);
  const view = useDatabaseView();
  const [rule, setRule] = useState<DatabaseRule | null>();
  const { database, rule: id, row } = target;

  useEffect(() => {
    const cancel = new AbortController();

    void ruleApi.get(workspace, database, id, cancel.signal, row).then(
      (value) => {
        if (!cancel.signal.aborted) setRule(value);
      },
      () => {
        if (!cancel.signal.aborted) setRule(null);
      }
    );
    return () => cancel.abort();
  }, [workspace, database, id, row]);

  const loading = <p role='status'>{t('databaseAutomation.loading')}</p>;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className='flex max-h-[85vh] w-[min(36rem,94vw)] flex-col overflow-auto'
      >
        <DialogHeader>
          <DialogTitle>{t('databaseAutomation.title')}</DialogTitle>
        </DialogHeader>
        {rule === null ? (
          <p role='alert'>{t('databaseAutomation.loadError')}</p>
        ) : !rule ? (
          loading
        ) : (
          <Suspense fallback={loading}>
            <fieldset disabled={waiting}>
              {waiting && <p role='status'>{t('databaseAutomation.loadError')}</p>}
              <RuleForm
                workspace={workspace}
                database={database}
                id={id}
                rowScope={row}
                base={rule}
                fields={properties}
                caps={caps}
                copyFilters={() => view?.get(YjsDatabaseKey.filters)?.toJSON() || []}
                back={close}
                saved={close}
              />
            </fieldset>
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  );
}
