import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Row } from '@/application/database-yjs';
import { useToggleHiddenGroupColumnDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as HideIcon } from '@/assets/icons/hide.svg';
import { ReactComponent as ShowIcon } from '@/assets/icons/show.svg';
import { useRenderColumn } from '@/components/database/components/board/column/useRenderColumn';
import DragItem from '@/components/database/components/drag-and-drop/DragItem';
import { Button } from '@/components/ui/button';
import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { HiddenItemMenu } from './HiddenItemMenu';

function HiddenColumnItem({
  id,
  fieldId,
  getRows: getRowsProp,
  groupId,
  isShownOnBoard,
  onColumnTemporarilyShownChange,
}: {
  id: string;
  fieldId: string;
  getRows: (id: string) => Row[];
  groupId: string;
  isShownOnBoard: boolean;
  onColumnTemporarilyShownChange: (columnId: string, shown: boolean) => void;
}) {
  const { t } = useTranslation();
  const { header } = useRenderColumn(id, fieldId);
  const getRows = useCallback(() => {
    return getRowsProp(id);
  }, [getRowsProp, id]);
  const count = useMemo(() => {
    return getRows().length;
  }, [getRows]);

  const [hover, setHover] = useState(false);
  const toggleHidden = useToggleHiddenGroupColumnDispatch(groupId, fieldId);

  return (
    <div
      data-testid={'board-hidden-group'}
      data-hidden-column-id={id}
      onMouseEnter={() => {
        setHover(true);
      }}
      onMouseLeave={() => {
        setHover(false);
      }}
      className={cn(dropdownMenuItemVariants({ variant: 'default' }))}
    >
      <DragItem id={id}>
        <HiddenItemMenu getRows={getRows}>
          <div className={'flex w-full items-center gap-1.5'}>
            <div data-testid={'board-hidden-group-name'} className={'w-auto max-w-[150px] overflow-hidden'}>{header}</div>
            <span className={'text-xs text-text-secondary'}>{count}</span>

            <Button
              data-testid={isShownOnBoard ? 'board-hidden-group-hide' : 'board-hidden-group-show'}
              aria-label={isShownOnBoard ? t('board.column.hideColumn') : t('board.mobile.showGroup')}
              className={cn('ml-auto', hover ? 'opacity-100' : 'opacity-0')}
              size={'icon'}
              variant={'ghost'}
              onClick={(e) => {
                e.stopPropagation();
                const shouldShow = !isShownOnBoard;

                onColumnTemporarilyShownChange(id, shouldShow);
                toggleHidden(id, !shouldShow);
              }}
            >
              {isShownOnBoard ? <HideIcon className={'h-5 w-5'} /> : <ShowIcon className={'h-5 w-5'} />}
            </Button>
          </div>
        </HiddenItemMenu>
      </DragItem>
    </div>
  );
}

export default HiddenColumnItem;
