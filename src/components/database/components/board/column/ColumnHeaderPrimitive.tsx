import { useRenderColumn } from '@/components/database/components/board/column/useRenderColumn';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import React, { forwardRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import { useTranslation } from 'react-i18next';

function ColumnHeaderPrimitive ({
  id,
  fieldId,
  className,
  rowCount,
  addCardBefore,
  ...props
}: {
  id: string;
  fieldId: string;
  rowCount: number;
  addCardBefore: (id: string) => void;
} & React.HTMLAttributes<HTMLDivElement>, ref: React.Ref<HTMLDivElement>) {
  const { header } = useRenderColumn(id, fieldId);
  const [hovered, setHovered] = useState(false);
  const { t } = useTranslation();

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      ref={ref}
      className={cn('column-header select-none flex overflow-hidden justify-start w-[240px] items-center gap-2 h-[26px] text-sm leading-[16px] font-medium whitespace-nowrap', className)}
      {...props}
    >
      <div className={'flex-1 flex items-center gap-2'}>
        <div className={'max-w-[180px] w-auto overflow-hidden'}>{header}</div>
        <span className={'text-text-secondary text-xs'}>{rowCount}</span>
      </div>
      {hovered && (<div className={'flex items-center gap-1'}>
        <Button
          variant={'ghost'}
          size={'icon-sm'}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <MoreIcon className={'w-5 h-5'} />
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={'ghost'}
              size={'icon-sm'}
              onClick={(e) => {
                e.stopPropagation();
                addCardBefore(id);
              }}
            >
              <AddIcon
                className={'w-5 h-5'}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side={'right'}>
            {t('board.column.addToColumnTopTooltip')}
          </TooltipContent>
        </Tooltip>

      </div>)}
    </div>
  );
}

export default forwardRef(ColumnHeaderPrimitive);