import { lazy, Suspense, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabase, useDatabaseContext } from '@/application/database-yjs';
import { resolveUserAttributionUid } from '@/application/database-yjs/attribution';
import { Role, YjsDatabaseKey } from '@/application/types';
import { useUserWorkspaceInfoOptional } from '@/components/app/app.hooks';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { getServerInfoSnapshot, SERVER_INFO_LOADING, subscribeToServerInfo } from '@/utils/server-info';

import { Capabilities, ruleCapabilities } from './model';

const RuleManager = lazy(() => import('./AutomationEditor').then((module) => ({ default: module.RuleManager })));

type Props = { rowId?: string; prepare?: () => Promise<boolean> };

export default function AutomationButton(props: Props = {}) {
  const { info } = useSyncExternalStore(subscribeToServerInfo, getServerInfoSnapshot, () => SERVER_INFO_LOADING);
  const caps = ruleCapabilities(info);

  if (!caps.enabled || (props.rowId !== undefined && !caps.triggers.includes('manual'))) return null;
  return <AvailableAutomationButton {...props} caps={caps} />;
}

function AvailableAutomationButton({ rowId, prepare, caps }: Props & { caps: Capabilities }) {
  const { t } = useTranslation();
  const { workspaceId, readOnly, canWrite, dataSource } = useDatabaseContext();
  const account = useUserWorkspaceInfoOptional();
  const owner = resolveUserAttributionUid(useCurrentUserOptional());
  const role = account?.workspaces.find((w) => w.id === workspaceId)?.role;
  const db = useDatabase();
  const databaseId = db?.get(YjsDatabaseKey.id);
  const [open, setOpen] = useState(false);

  if (
    (rowId !== undefined && (!rowId || !owner)) ||
    !account ||
    (role !== Role.Member && role !== Role.Owner) ||
    !workspaceId ||
    !databaseId ||
    readOnly ||
    canWrite === false ||
    dataSource?.type === 'history'
  )
    return null;
  const row = rowId && owner ? { id: rowId, owner } : undefined;
  const label = t(row ? 'databaseAutomation.run' : 'databaseAutomation.title');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {row ? (
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
            <RuleManager
              row={row}
              key={[workspaceId, databaseId, owner, rowId].join('/')}
              workspace={workspaceId}
              database={databaseId}
              caps={caps}
            />
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  );
}
