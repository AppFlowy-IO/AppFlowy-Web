import { lazy, Suspense, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabase, useDatabaseContextOptional } from '@/application/database-yjs';
import { getTypeOptions } from '@/application/database-yjs/fields/type_option';
import { FieldType } from '@/application/database-yjs/database.type';
import { type YDatabaseField, YjsDatabaseKey } from '@/application/types';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import { useAutomationCapabilities } from './useAutomationCapabilities';

const ButtonControl = lazy(() => import('./ButtonControl').then((mod) => ({ default: mod.ButtonControl })));

export function ButtonCell({ rowId, fieldId, field }: { rowId: string; fieldId: string; field: YDatabaseField }) {
  const { t } = useTranslation();
  const caps = useAutomationCapabilities();
  const db = useDatabase();
  const context = useDatabaseContextOptional();
  const user = useCurrentUserOptional();
  const configuredLabel = getTypeOptions(field, FieldType.Button)?.get('label');
  const label =
    (typeof configuredLabel === 'string' && configuredLabel.trim()) ||
    field.get(YjsDatabaseKey.name) ||
    t('databaseAutomation.run');
  const [open, setOpen] = useState(false);
  const dismiss = useCallback(() => setOpen(false), []);
  const database = db?.get(YjsDatabaseKey.id);
  const workspace = context?.workspaceId;

  if (
    !caps.enabled ||
    !caps.triggers.includes('button') ||
    !user ||
    !workspace ||
    !database ||
    context?.dataSource?.type === 'history'
  )
    return <span className='truncate'>{label}</span>;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size='sm'
          variant='outline'
          type='button'
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent
        className='flex max-h-[85vh] w-[min(36rem,94vw)] flex-col overflow-auto'
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription className='sr-only'>{t('databaseAutomation.buttonTooltip')}</DialogDescription>
        </DialogHeader>
        {open && (
          <Suspense fallback={<p role='status'>{t('databaseAutomation.loading')}</p>}>
            <ButtonControl
              key={[workspace, database, rowId, fieldId, user?.uuid].join('/')}
              onNavigated={dismiss}
              {...{ workspace, database, row: rowId, field: fieldId, caps }}
            />
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  );
}
