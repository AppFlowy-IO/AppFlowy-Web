import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MentionablePerson, MentionPersonRole, WorkspaceGroup } from '@/application/types';
import { ReactComponent as AtIcon } from '@/assets/icons/invite_user.svg';
import { cn } from '@/lib/utils';

import { PersonAvatar } from './PersonAvatar';

export type InviteSuggestion =
  | { type: 'user'; data: MentionablePerson }
  | { type: 'email'; data: string }
  | { type: 'group'; data: WorkspaceGroup };

interface PersonSuggestionItemProps {
  suggestion: InviteSuggestion;
  isHovered: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}

export function PersonSuggestionItem({ suggestion, isHovered, onClick, onMouseEnter }: PersonSuggestionItemProps) {
  const { t } = useTranslation();

  if (suggestion.type === 'group') {
    const group = suggestion.data;

    return (
      <div
        className={cn(
          'flex w-full cursor-pointer items-center gap-2 rounded-300 px-2 py-1.5',
          'hover:bg-fill-content-hover',
          isHovered && 'bg-fill-content-hover'
        )}
        onMouseEnter={onMouseEnter}
        onClick={onClick}
      >
        <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fill-content-hover text-icon-secondary'>
          <Users className='h-5 w-5' />
        </div>
        <div className='flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden'>
          <div className='truncate text-sm text-text-primary'>{group.name}</div>
          <div className='truncate whitespace-nowrap text-xs text-text-secondary'>
            {t('shareAction.groupMembersCount', { count: group.member_count })}
          </div>
        </div>
      </div>
    );
  }

  if (suggestion.type === 'user') {
    const person = suggestion.data;
    const isGuest = person.role === MentionPersonRole.Guest;

    return (
      <div
        className={cn(
          'flex w-full cursor-pointer items-center gap-2 rounded-300 px-2 py-1.5',
          'hover:bg-fill-content-hover',
          isHovered && 'bg-fill-content-hover'
        )}
        onMouseEnter={onMouseEnter}
        onClick={onClick}
      >
        <div className='flex w-full flex-row items-center gap-2 overflow-hidden'>
          <PersonAvatar avatarUrl={person.avatar_url || ''} name={person.name} />
          <div className='flex w-full flex-1 flex-col gap-0.5 overflow-hidden'>
            <div className='flex items-center gap-2'>
              <div className='truncate text-sm text-text-primary'>{person.name}</div>
              {isGuest && (
                <span className='rounded-full bg-fill-warning-light px-2 py-[1px] text-xs text-text-warning-on-fill'>
                  {t('shareAction.guest')}
                </span>
              )}
            </div>
            <div className='truncate whitespace-nowrap text-xs text-text-secondary'>{person.email}</div>
          </div>
        </div>
      </div>
    );
  }

  // Email suggestion
  return (
    <div
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-300 px-2 py-1.5 text-sm',
        'hover:bg-fill-content-hover',
        isHovered && 'bg-fill-content-hover'
      )}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <AtIcon className='h-5 w-5 text-text-primary' />
      <div className='text-text-primary'>{suggestion.data}</div>
    </div>
  );
}
