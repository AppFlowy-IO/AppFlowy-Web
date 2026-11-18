import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { v4 as uuid } from 'uuid';

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

import { type Capabilities } from './model';
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
  const database = db?.get(YjsDatabaseKey.id);
  const workspace = context?.workspaceId;
  const scope = [workspace, database, rowId, fieldId, user?.uuid].join('/');

  if (
    !caps.enabled ||
    !caps.triggers.includes('button') ||
    !user ||
    !workspace ||
    !database ||
    context?.dataSource?.type === 'history'
  )
    return <span className='truncate'>{label}</span>;
  return <ActiveButtonCell key={scope} {...{ workspace, database, rowId, fieldId, caps, label }} />;
}

function ActiveButtonCell({
  workspace,
  database,
  rowId,
  fieldId,
  caps,
  label,
}: {
  workspace: string;
  database: string;
  rowId: string;
  fieldId: string;
  caps: Capabilities;
  label: string;
}) {
  const { t } = useTranslation();
  const [gesture, setGesture] = useState<string>();
  const active = useRef(false);
  const open = gesture !== undefined;
  const dismiss = useCallback(() => {
    active.current = false;
    setGesture(undefined);
  }, []);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogTrigger asChild>
        <Button
          size='sm'
          variant='outline'
          type='button'
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            if (active.current) return;
            active.current = true;
            setGesture(uuid());
          }}
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
              initialClickId={gesture}
              onNavigated={dismiss}
              {...{ workspace, database, row: rowId, field: fieldId, caps }}
            />
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  );
}
