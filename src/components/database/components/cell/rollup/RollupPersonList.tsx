import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType } from '@/application/database-yjs/database.type';
import { canonicalizeUserUid } from '@/application/user-uid';
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

// Shared storage contract with PersonCell and the cloud form-submission handler.
const ANONYMOUS_RESPONDENT_ID = '00000000-0000-0000-0000-000000000000';

/** Person cells arrive as joined JSON arrays; decimal attribution IDs must never pass through Number. */
export function parseRollupPersonIds(raw: string): string[] {
  const value = raw.trim();

  if (!value) return [];
  if (/^\d+(?:\s*,\s*\d+)*$/.test(value)) return value.split(',').map((id) => id.trim());
  const flatten = (item: unknown): string[] | null => {
    if (typeof item === 'string') return item ? [item] : [];
    if (!Array.isArray(item)) return null;
    const children = item.map(flatten);

    return children.some((child) => child === null) ? null : (children as string[][]).flat();
  };

  for (const candidate of [value, `[${value}]`]) {
    try {
      const ids = flatten(JSON.parse(candidate));

      if (ids !== null) return ids;
    } catch {
      /* Try the joined-array representation. */
    }
  }

  return [value];
}

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
