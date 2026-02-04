import { Suspense } from 'react';

import { AppendBreadcrumb } from '@/application/types';
import EditorSkeleton from '@/components/_shared/skeleton/EditorSkeleton';
import TableSkeleton from '@/components/_shared/skeleton/TableSkeleton';
import { DatabaseRowProperties, RowSubDocument } from '@/components/database/components/database-row';
import DatabaseRowHeader from '@/components/database/components/header/DatabaseRowHeader';
import { cn } from '@/lib/utils';

import { Separator } from '../ui/separator';

export function DatabaseRow({ appendBreadcrumb, rowId }: { rowId: string; appendBreadcrumb?: AppendBreadcrumb }) {
  return (
    <div className={'flex w-full justify-center'}>
      <div className={cn('relative flex w-[952px] min-w-0 max-w-full flex-col gap-4')}>
        <DatabaseRowHeader appendBreadcrumb={appendBreadcrumb} rowId={rowId} />

        <div className={'flex w-full flex-1 flex-col gap-4'}>
          <Suspense fallback={<TableSkeleton columns={2} rows={4} />}>
            <DatabaseRowProperties rowId={rowId} />
          </Suspense>
          <div className='px-24 max-sm:px-6'>
            <Separator />
          </div>

          <Suspense fallback={<EditorSkeleton />}>
            <div className={'min-h-[300px]'}>
              <RowSubDocument rowId={rowId} />
            </div>
          </Suspense>
        </div>
      </div>
    </div>
  );
}

export default DatabaseRow;
