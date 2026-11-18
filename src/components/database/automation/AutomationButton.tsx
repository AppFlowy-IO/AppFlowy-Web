import { lazy, Suspense, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabase, useDatabaseContext } from '@/application/database-yjs';
import { Role, YjsDatabaseKey } from '@/application/types';
import { useUserWorkspaceInfoOptional } from '@/components/app/app.hooks';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { getServerInfoSnapshot, SERVER_INFO_LOADING, subscribeToServerInfo } from '@/utils/server-info';

import { ruleCapabilities } from './model';

const RuleManager = lazy(() => import('./AutomationEditor').then((module) => ({ default: module.RuleManager })));

export default function AutomationButton() {
  const { t } = useTranslation();
  const { info } = useSyncExternalStore(subscribeToServerInfo, getServerInfoSnapshot, () => SERVER_INFO_LOADING);
  const { workspaceId, readOnly, canWrite, dataSource } = useDatabaseContext();
  const account = useUserWorkspaceInfoOptional();
  const role = account?.workspaces.find((w) => w.id === workspaceId)?.role;
  const db = useDatabase();
  const databaseId = db?.get(YjsDatabaseKey.id);
  const caps = ruleCapabilities(info);
  const [open, setOpen] = useState(false);

  if (
    !caps.enabled ||
    !account ||
    (role !== Role.Member && role !== Role.Owner) ||
    !workspaceId ||
    !databaseId ||
    readOnly ||
    canWrite === false ||
    dataSource?.type === 'history'
  )
    return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant='ghost' size='sm'>
          {t('databaseAutomation.title')}
        </Button>
      </DialogTrigger>
      <DialogContent className='flex max-h-[85vh] w-[min(36rem,94vw)] flex-col overflow-auto'>
        <DialogHeader>
          <DialogTitle>{t('databaseAutomation.title')}</DialogTitle>
        </DialogHeader>
        {open && (
          <Suspense fallback={null}>
            <RuleManager key={workspaceId + databaseId} workspace={workspaceId} database={databaseId} caps={caps} />
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  );
}
