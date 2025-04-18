import { useDatabaseContext, useRowMetaSelector } from '@/application/database-yjs';
import { TextCell as CellType, CellProps } from '@/application/database-yjs/cell.type';
import { TextCell } from '@/components/database/components/cell/text';
import { getPlatform } from '@/utils/platform';
import React, { useMemo } from 'react';
import { ReactComponent as DocumentSvg } from '@/assets/icons/doc.svg';

export function PrimaryCell (
  props: CellProps<CellType> & {
    showDocumentIcon?: boolean;
  },
) {
  const { rowId, showDocumentIcon } = props;
  const meta = useRowMetaSelector(rowId);
  const navigateToRow = useDatabaseContext().navigateToRow;
  const hasDocument = meta?.isEmptyDocument === false;
  const icon = meta?.icon;

  const isMobile = useMemo(() => {
    return getPlatform()?.isMobile;
  }, []);

  return (
    <div
      onClick={() => {
        if (isMobile) {
          navigateToRow?.(rowId);
        }
      }}
      className={'primary-cell relative flex h-full w-full gap-2'}
    >
      {icon ? (
        <div className={'flex h-5 w-5 items-center justify-center text-base'}>{icon}</div>
      ) : hasDocument && showDocumentIcon ? (
        <DocumentSvg className={'h-5 w-5'} />
      ) : null}
      <div className={'flex-1 overflow-x-hidden'}>
        <TextCell {...props} />
      </div>
    </div>
  );
}

export default PrimaryCell;
