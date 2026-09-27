import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType } from '@/application/database-yjs/database.type';
import { parseRollupPersonIds } from '@/application/database-yjs/fields/rollup/person';
import { canonicalizeUserUid } from '@/application/user-uid';
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

// Shared storage contract with PersonCell and the cloud form-submission handler.
const ANONYMOUS_RESPONDENT_ID = '00000000-0000-0000-0000-000000000000';

export function RollupPersonList({ value, type }: { value: string; type: FieldType }) {
  const { t } = useTranslation();
  const ids = useMemo(() => parseRollupPersonIds(value), [value]);
  const shouldFetch = ids.some((id) => type !== FieldType.Person || id !== ANONYMOUS_RESPONDENT_ID);
  const { users } = useMentionableUsersWithAutoFetch(shouldFetch);
  const byId = useMemo(
    () =>
      new Map(users.map((user) => [type === FieldType.Person ? user.person_id : canonicalizeUserUid(user.uid), user])),
    [type, users]
  );

  return (
    <>
      {ids.map((id, index) => {
        const isAnonymous = type === FieldType.Person && id === ANONYMOUS_RESPONDENT_ID;
        const user = byId.get(id);
        const label = isAnonymous ? t('signIn.anonymous') : user?.name || user?.email || id;

        return (
          <span
            key={`${id}-${index}`}
            data-testid='rollup-person-item'
            className='flex min-w-0 max-w-[160px] shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-fill-secondary px-1'
          >
            {user || isAnonymous ? (
              <Avatar className='h-5 w-5 shrink-0'>
                <AvatarImage src={isAnonymous ? undefined : user?.avatar_url || undefined} alt={label} />
                <AvatarFallback className='text-xs' name={label}>
                  {isAnonymous ? '·' : label.charAt(0)}
                </AvatarFallback>
              </Avatar>
            ) : null}
            <span className='truncate text-sm'>{label}</span>
          </span>
        );
      })}
    </>
  );
}
