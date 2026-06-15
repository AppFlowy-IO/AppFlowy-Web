import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Workspace } from '@/application/types';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as LeaveSvg } from '@/assets/icons/logout.svg';
import { ReactComponent as MoreSvg } from '@/assets/icons/more.svg';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

function MoreActions({
  workspace,
  onUpdate,
  onDelete,
  onLeave,
  workspaceCount,
}: {
  workspace: Workspace;
  onUpdate?: () => void;
  onDelete?: () => void;
  onLeave?: () => void;
  workspaceCount?: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const currentUser = useCurrentUser();
  const isOwner = workspace.owner?.uid.toString() === currentUser?.uid.toString();

  return (
    <>
      <Popover modal open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            onClick={(e) => {
              e.stopPropagation();
            }}
            size={'icon-sm'}
            variant={'ghost'}
            className={'text-icon-primary'}
          >
            <MoreSvg className={'h-5 w-5'} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align='start' className='min-w-fit p-2'>
          {isOwner ? (
            <div className={'flex flex-col'}>
              <div
                className={dropdownMenuItemVariants({ variant: 'default', className: 'w-full overflow-hidden' })}
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate?.();
                  setOpen(false);
                }}
              >
                <EditIcon />
                {t('workspace.rename')}
              </div>
              {(workspaceCount ?? 1) > 1 && (
                <div
                  className={dropdownMenuItemVariants({ variant: 'destructive', className: 'w-full overflow-hidden' })}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete?.();
                    setOpen(false);
                  }}
                >
                  <DeleteIcon />
                  {t('workspace.delete')}
                </div>
              )}
            </div>
          ) : (
            <div
              className={dropdownMenuItemVariants({ variant: 'destructive', className: 'w-full overflow-hidden' })}
              onClick={(e) => {
                e.stopPropagation();
                onLeave?.();
                setOpen(false);
              }}
            >
              <LeaveSvg />
              {t('workspace.leave')}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}

export default MoreActions;
