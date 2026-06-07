import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

import { GroupColorOption, Row, useReadOnly } from '@/application/database-yjs';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import { BoardColumnColorStyle } from '@/components/database/components/board/column/boardColumnColor';
import { ColumnMenu } from '@/components/database/components/board/column/ColumnMenu';
import { useRenderColumn } from '@/components/database/components/board/column/useRenderColumn';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

function ColumnHeaderPrimitive(
  {
    id,
    fieldId,
    className,
    rowCount,
    addCardBefore,
    getCards,
    groupId,
    colorStyle,
    colorOption,
    showColorColumns,
    ...props
  }: {
    id: string;
    fieldId: string;
    rowCount: number;
    getCards: (id: string) => Row[];
    addCardBefore: (id: string) => void;
    groupId: string;
    colorStyle?: BoardColumnColorStyle;
    colorOption?: GroupColorOption;
    showColorColumns?: boolean;
  } & React.HTMLAttributes<HTMLDivElement>,
  ref: React.Ref<HTMLDivElement>
) {
  const { header, renameEnabled, deleteEnabled, hideEnabled } = useRenderColumn(id, fieldId, colorStyle);
  const { t } = useTranslation();
  const readOnly = useReadOnly();

  return (
    <div
      ref={ref}
      className={cn(
        'column-header relative flex h-[26px] w-[240px] select-none items-center justify-start gap-2 overflow-hidden whitespace-nowrap text-sm font-medium leading-[16px]',
        className
      )}
      {...props}
    >
      <div className={'flex flex-1 items-center gap-2'}>
        <div className={'w-auto max-w-[170px] overflow-hidden'}>{header}</div>
        <span className={'text-xs text-text-secondary'}>{rowCount}</span>
      </div>
      {!readOnly && (
        <div className={'flex items-center'}>
          <ColumnMenu
            groupId={groupId}
            id={id}
            fieldId={fieldId}
            renameEnabled={renameEnabled}
            deleteEnabled={deleteEnabled}
            hideEnabled={hideEnabled}
            getCards={getCards}
            showColorColumns={Boolean(showColorColumns)}
            currentColorOption={colorOption}
          >
            <Button variant={'ghost'} size={'icon-sm'} className={'text-icon-secondary'}>
              <MoreIcon className={'h-5 w-5'} />
            </Button>
          </ColumnMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={'ghost'}
                size={'icon-sm'}
                onClick={(e) => {
                  e.preventDefault();
                  addCardBefore(id);
                }}
                className={'text-icon-secondary'}
              >
                <AddIcon className={'h-5 w-5'} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('board.column.addToColumnTopTooltip')}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

export default forwardRef(ColumnHeaderPrimitive);
