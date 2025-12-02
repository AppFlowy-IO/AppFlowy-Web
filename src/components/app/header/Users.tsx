import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Log } from '@/utils/log';
import { useUsersSelector } from '@/application/awareness/selector';
import { useAppAwareness } from '@/components/app/app.hooks';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const isImageSource = (value?: string) => {
  if (!value) return false;

  return /^https?:\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:');
};

export function Users({ viewId }: { viewId?: string }) {
  const { t } = useTranslation();
  const awareness = useAppAwareness(viewId);

  const users = useUsersSelector(awareness);

  useEffect(() => {
    Log.debug('[Header.Users] users updated', users);
  }, [users]);

  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const MAX_VISIBLE_USERS = 4;
  const visibleUsers = users.slice(0, MAX_VISIBLE_USERS);
  const remainingUsers = users.slice(MAX_VISIBLE_USERS);
  const hasMoreUsers = users.length > MAX_VISIBLE_USERS;

  return (
    <div className='*:data-[slot=avatar]:ring-background flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:grayscale'>
      {visibleUsers.map((user, index) => (
        <TooltipProvider key={`${user.uid}/${user.device_id}`}>
          <Tooltip delayDuration={800}>
            <TooltipTrigger>
              <Avatar style={{ zIndex: visibleUsers.length - index, border: '1px solid var(--border-primary)' }}>
                <AvatarImage src={user.avatar} alt={''} />
                <AvatarFallback name={user.name}>
                  
                  {user.avatar && !isImageSource(user.avatar) ? (
                    <span className='text-lg'>{user.avatar}</span>
                  ) : (
                    user.name
                  )}
                </AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            <TooltipContent>
              <p>{user.name}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}

      {hasMoreUsers && (
        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
          <PopoverTrigger asChild>
            <div className='cursor-pointer'>
              <TooltipProvider>
                <Tooltip delayDuration={800}>
                  <TooltipTrigger>
                    <Avatar style={{ zIndex: 0 }}>
                      <AvatarFallback className='bg-fill-content-visible text-text-caption'>
                        +{remainingUsers.length}
                      </AvatarFallback>
                    </Avatar>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t('view_more_users')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </PopoverTrigger>
          <PopoverContent className='w-48 p-2' align='end'>
            <div className='space-y-2'>
              <div className='px-2 py-1 text-sm font-medium text-text-title'>
                {t('other_users', { count: remainingUsers.length })}
              </div>
              <div className='space-y-1'>
                {remainingUsers.map((user) => (
                  <div
                    key={user.uid}
                    className='hover:bg-background-secondary flex items-center space-x-2 rounded px-2 py-1'
                  >
                    <Avatar size='sm'>
                      <AvatarFallback>{user.name}</AvatarFallback>
                    </Avatar>
                    <span className='flex-1 truncate text-sm text-text-title' title={user.name}>
                      {user.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
