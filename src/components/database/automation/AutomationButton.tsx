import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabase, useDatabaseContext } from '@/application/database-yjs';
import { resolveUserAttributionUid } from '@/application/database-yjs/attribution';
import { ruleApi } from '@/application/services/js-services/http/automation-api';
import { Role, YjsDatabaseKey } from '@/application/types';
import { useUserWorkspaceInfoOptional } from '@/components/app/app.hooks';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';

import { Capabilities } from './model';
import { useEditorCapabilities } from './useAutomationCapabilities';

const RuleManager = lazy(() => import('./AutomationEditor').then((module) => ({ default: module.RuleManager })));

type Props = { rowId?: string; prepare?: () => Promise<boolean>; standaloneRow?: boolean };

export default function AutomationButton(props: Props = {}) {
  const { caps, waiting } = useEditorCapabilities();

  if (!caps.enabled) return null;
  if (props.rowId === undefined) return <AvailableAutomationButton {...props} caps={caps} waiting={waiting} />;
  return (
    <>
      {caps.rowScoped && <AvailableAutomationButton {...props} caps={caps} waiting={waiting} scoped />}
      {!props.standaloneRow && caps.triggers.includes('manual') && (
        <AvailableAutomationButton {...props} caps={caps} waiting={waiting} />
      )}
    </>
  );
}

function AvailableAutomationButton({
  rowId,
  prepare,
  caps,
  scoped,
  waiting,
  standaloneRow,
}: Props & { caps: Capabilities; waiting: boolean; scoped?: boolean }) {
  const { t } = useTranslation();
  const { workspaceId, readOnly, canWrite, dataSource } = useDatabaseContext();
  const account = useUserWorkspaceInfoOptional();
  const user = useCurrentUserOptional();
  const owner = resolveUserAttributionUid(user);
  const role = account?.workspaces.find((w) => w.id === workspaceId)?.role;
  const db = useDatabase();
  const databaseId = db?.get(YjsDatabaseKey.id);
  const [open, setOpen] = useState(false);
  const [accessKey, setAccessKey] = useState<string>();
  const eligible = !!(user && workspaceId && databaseId && rowId && dataSource?.type !== 'history');
  const key = JSON.stringify([workspaceId, databaseId, rowId, user?.uuid || owner]);

  useEffect(() => {
    if (!scoped || !eligible || !workspaceId || !databaseId || !rowId) return;
    const controller = new AbortController();

    setAccessKey(undefined);
    // A writable shared row can be inside a database the guest cannot manage.
    void ruleApi
      .list(workspaceId, databaseId, controller.signal, rowId)
      .then(() => {
        if (!controller.signal.aborted) setAccessKey(key);
      })
      .catch(() => {
        if (!controller.signal.aborted) setAccessKey(undefined);
      });
    return () => controller.abort();
  }, [scoped, eligible, workspaceId, databaseId, rowId, key]);

  if (
    (waiting && !open) ||
    (rowId !== undefined && (!rowId || (!scoped && !owner))) ||
    (scoped ? accessKey !== key : !account) ||
    (!scoped && role !== Role.Member && role !== Role.Owner) ||
    !workspaceId ||
    !databaseId ||
    (!scoped && (readOnly || canWrite === false)) ||
    dataSource?.type === 'history'
  )
    return null;
  const row = !scoped && rowId && owner ? { id: rowId, owner } : undefined;
  const label = t(scoped ? 'databaseAutomation.rowRules' : row ? 'databaseAutomation.run' : 'databaseAutomation.title');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {rowId !== undefined && !standaloneRow ? (
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            if (prepare)
              void prepare().then((saved) => {
                if (saved) setOpen(true);
              });
            else setOpen(true);
          }}
        >
          {label}
        </DropdownMenuItem>
      ) : (
        <DialogTrigger asChild>
          <Button variant='ghost' size='sm'>
            {label}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className='flex max-h-[85vh] w-[min(36rem,94vw)] flex-col overflow-auto'>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        {open && (
          <Suspense fallback={<p role='status'>{t('databaseAutomation.loading')}</p>}>
            <fieldset disabled={waiting}>
              {waiting && <p role='status'>{t('databaseAutomation.loadError')}</p>}
              <RuleManager
                row={row}
                viewerUid={owner || undefined}
                rowScope={scoped ? rowId : undefined}
                key={[workspaceId, databaseId, owner, rowId].join('/')}
                workspace={workspaceId}
                database={databaseId}
                caps={caps}
              />
            </fieldset>
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  );
}
