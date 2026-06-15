import React, { forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ViewMetaCover } from '@/application/types';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import CoverPopover from '@/components/view-meta/CoverPopover';
import { cn } from '@/lib/utils';

function ViewCoverActions(
  {
    coverValue,
    show,
    onRemove,
    onUpdateCover,
    fullWidth,
  }: {
    coverValue?: string;
    show: boolean;
    onRemove: () => void;
    onUpdateCover: (cover: ViewMetaCover) => void;
    fullWidth?: boolean;
  },
  ref: React.ForwardedRef<HTMLDivElement>
) {
  const { t } = useTranslation();
  const [showPopover, setShowPopover] = useState(false);

  return (
    <>
      <div
        className={cn(
          'absolute bottom-0 left-1/2 -translate-x-1/2 transform',
          fullWidth ? 'w-full' : 'w-[964px] min-w-0 max-w-full'
        )}
      >
        <div
          ref={ref}
          className={cn(
            `absolute bottom-4 right-0 items-center space-x-2 p-2`,
            show ? 'flex' : 'opacity-0',
            fullWidth && 'pr-6'
          )}
        >
          <div className={'flex items-center space-x-2'}>
            <CoverPopover
              onUpdateCover={onUpdateCover}
              open={showPopover}
              onOpenChange={setShowPopover}
              coverValue={coverValue}
            >
              <Button
                variant={'default'}
                size={'sm'}
                className={'bg-surface-primary text-text-primary hover:bg-surface-primary-hover'}
              >
                {t('document.plugins.cover.changeCover')}
              </Button>
            </CoverPopover>

            <Tooltip>
              <TooltipContent>{t('document.plugins.cover.removeCover')}</TooltipContent>
              <TooltipTrigger asChild>
                <Button
                  variant={'default'}
                  className={
                    'bg-surface-primary text-text-primary hover:bg-surface-primary-hover hover:text-icon-error-thick'
                  }
                  size={'icon'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                  }}
                >
                  <DeleteIcon className={'h-5 w-5'} />
                </Button>
              </TooltipTrigger>
            </Tooltip>
          </div>
        </div>
      </div>
    </>
  );
}

export default forwardRef(ViewCoverActions);
