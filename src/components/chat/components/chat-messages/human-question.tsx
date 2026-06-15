import { useEffect, useState } from 'react';

import { stringToColor } from '@/components/chat/lib/utils';
import { User } from '@/components/chat/types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';


function HumanQuestion({
  content,
  userId,
  fetchMember,
}: {
  content: string;
  userId: string;
  fetchMember: (uuid: string) => Promise<User>;
}) {
  const [member, setMember] = useState<User | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const member = await fetchMember(userId);

        setMember(member);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [fetchMember, userId]);

  const name = member?.name || 'Anonymous';

  return (
    <div className={`flex w-full gap-2`}>
      <div className={'flex flex-1 items-center justify-end'}>
        <div className={'w-fit max-w-[83%] rounded-[16px] bg-muted px-4 py-2'}>{content}</div>
      </div>
      <Avatar className={'h-9 w-9 border border-border'}>
        <AvatarFallback
          style={{
            background: stringToColor(name),
          }}
        >
          {name[0]}
        </AvatarFallback>
      </Avatar>
    </div>
  );
}

export default HumanQuestion;
