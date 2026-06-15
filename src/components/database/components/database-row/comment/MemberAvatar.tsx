import { memo } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

import { useRowCommentState } from './RowCommentContext';

/**
 * Renders a workspace member's avatar given their uid.
 * Resolves name and avatar_url from the mentionable users list in RowCommentContext.
 */
function MemberAvatar({ uid, size = 'md' }: { uid: string; size?: 'xs' | 'sm' | 'md' | 'xl' }) {
  const { members } = useRowCommentState();
  const member = members.get(uid);
  const displayName = member?.name || member?.email || uid;
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <Avatar size={size}>
      {member?.avatar_url ? (
        <AvatarImage src={member.avatar_url} alt={displayName} />
      ) : null}
      <AvatarFallback>{initial}</AvatarFallback>
    </Avatar>
  );
}

export function getMemberDisplayName(members: Map<string, { name: string; email: string }>, uid: string): string {
  const member = members.get(uid);

  return member?.name || member?.email || uid;
}

export default memo(MemberAvatar);
