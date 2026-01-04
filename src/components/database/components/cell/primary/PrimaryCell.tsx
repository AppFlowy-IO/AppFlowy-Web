import { useMemo, useRef } from 'react';

import { RowMetaKey, useDatabaseContext, useRowMetaSelector } from '@/application/database-yjs';
import { Cell as CellType, CellProps } from '@/application/database-yjs/cell.type';
import { useUpdateRowMetaDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as DocumentSvg } from '@/assets/icons/doc.svg';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import { Cell as DatabaseCell } from '@/components/database/components/cell';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isFlagEmoji } from '@/utils/emoji';
import { getPlatform } from '@/utils/platform';

export function PrimaryCell(props: CellProps<CellType>) {
  const { rowId, readOnly } = props;
  const ref = useRef<HTMLDivElement>(null);
  const meta = useRowMetaSelector(rowId);
  const navigateToRow = useDatabaseContext().navigateToRow;

  const hasDocument = meta?.isEmptyDocument === false;
  const icon = meta?.icon;

  const isMobile = useMemo(() => {
    return getPlatform()?.isMobile;
  }, []);
  const onUpdateMeta = useUpdateRowMetaDispatch(rowId);

  const showIcon = icon || hasDocument;

  const isFlag = useMemo(() => {
    if (!icon) return false;
    return isFlagEmoji(icon);
  }, [icon]);

  return (
    <div
      ref={ref}
      onClick={() => {
        if (isMobile) {
          navigateToRow?.(rowId);
        }
      }}
      className={'primary-cell  relative flex w-full items-start gap-2'}
    >
      <CustomIconPopover
        defaultActiveTab={'emoji'}
        tabs={['emoji']}
        onSelectIcon={(icon) => {
          onUpdateMeta(RowMetaKey.IconId, icon.value);
        }}
        removeIcon={() => {
          onUpdateMeta(RowMetaKey.IconId, undefined);
        }}
        enable={Boolean(!readOnly && showIcon)}
      >
        {showIcon ? (
          <Button
            className={'custom-icon h-5 w-5 !rounded-100 p-0 disabled:text-icon-primary'}
            variant={'ghost'}
            disabled={readOnly}
          >
            {icon ? (
              <div className={cn('flex h-5 w-5 items-center justify-center', isFlag && 'icon')}>{icon}</div>
            ) : (
              <DocumentSvg className={'h-5 w-5'} />
            )}
          </Button>
        ) : null}
      </CustomIconPopover>

      <div className={'flex flex-1 items-center overflow-x-hidden'}>
        <DatabaseCell {...props} />
      </div>
    </div>
  );
}

export default PrimaryCell;
