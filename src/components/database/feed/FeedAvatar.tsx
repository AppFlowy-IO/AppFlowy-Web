import { ReactComponent as UserIcon } from '@/assets/icons/user.svg';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

import type { FeedMember } from './FeedMembersContext';

/** 24px avatar matching Desktop `UserAvatar(size: AFAvatarSize.s)` in feed cards. */
export function FeedAvatar({ className, member, testId }: { className?: string; member?: FeedMember; testId?: string }) {
  if (!member) {
    return (
      <span
        aria-hidden='true'
        className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fill-tertiary', className)}
        data-testid={testId}
      >
        <UserIcon className='h-3.5 w-3.5 text-icon-secondary' />
      </span>
    );
  }

  const displayName = member.name || member.email;
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <Avatar className={cn('shrink-0', className)} data-testid={testId} size='sm'>
      {member.avatarUrl ? <AvatarImage alt={displayName} src={member.avatarUrl} /> : null}
      <AvatarFallback name={displayName}>{initial}</AvatarFallback>
    </Avatar>
  );
}

export default FeedAvatar;
