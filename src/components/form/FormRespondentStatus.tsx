import { useEffect, useState } from 'react';

import { getPublicFormStoredUser } from '@/application/services/js-services/http/public-form-client';
import type { User } from '@/application/types';
import { getUserIconUrl } from '@/application/user-metadata';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface RespondentIdentity {
  avatarUrl: string;
  displayName: string;
}

/**
 * Mirrors the effective attribution policy returned by the public Form API.
 * `anonymous=true` is authoritative: the server discards member identity even
 * when the browser has an authenticated session.
 */
export function FormRespondentStatus({ anonymous }: { anonymous: boolean }) {
  if (anonymous) {
    return (
      <div
        data-testid='public-form-respondent-status'
        className='w-fit max-w-full rounded-300 bg-fill-list-active px-3 py-2 text-sm text-text-secondary'
      >
        Submitting response anonymously
      </div>
    );
  }

  return <AttributedRespondentStatus />;
}

function AttributedRespondentStatus() {
  const identity = usePublicFormRespondentIdentity() ?? {
    avatarUrl: '',
    displayName: 'Workspace member',
  };

  return (
    <div
      data-testid='public-form-respondent-status'
      aria-label={`Submitting response as ${identity.displayName}`}
      className='inline-flex max-w-full items-center gap-1.5 rounded-300 bg-fill-list-active px-3 py-2 text-sm text-text-secondary'
    >
      <span className='shrink-0'>Submitting response as </span>
      <Avatar size='xs' aria-hidden>
        {identity.avatarUrl ? <AvatarImage src={identity.avatarUrl} alt='' /> : null}
        <AvatarFallback name={identity.displayName}>{identity.displayName}</AvatarFallback>
      </Avatar>
      <span className='min-w-0 truncate font-medium text-text-primary' title={identity.displayName}>
        {identity.displayName}
      </span>
    </div>
  );
}

/**
 * Public Form routes deliberately avoid AppConfig and the authenticated app
 * provider graph. Prefer its context when this component is reused by an app
 * surface, then fall back to the signed-in account's persisted profile. The
 * token email keeps the status useful while IndexedDB is still resolving.
 */
function usePublicFormRespondentIdentity(): RespondentIdentity | null {
  const contextualUser = useCurrentUserOptional();
  const contextualUserId = contextualUser?.uuid;
  const tokenUser = getPublicFormStoredUser();
  const tokenUserId = tokenUser?.id;
  const tokenEmail = normalized(tokenUser?.email);
  const [cachedUser, setCachedUser] = useState<User>();

  useEffect(() => {
    if (contextualUserId || !tokenUserId) return;

    let cancelled = false;

    void import('@/application/db')
      .then(({ db }) => db.users.get(tokenUserId))
      .then((user) => {
        if (!cancelled) setCachedUser(user);
      })
      .catch(() => {
        // A blocked/unavailable IndexedDB must not prevent the public Form
        // from rendering. The token email remains a safe local fallback.
      });

    return () => {
      cancelled = true;
    };
  }, [contextualUserId, tokenUserId]);

  const persistedUser = cachedUser?.uuid === tokenUserId ? cachedUser : undefined;
  const user = contextualUser ?? persistedUser;
  const displayName = normalized(user?.name) || normalized(user?.email) || tokenEmail;

  if (!displayName) return null;

  return {
    avatarUrl: user ? getUserIconUrl(user) : '',
    displayName,
  };
}

function normalized(value: string | null | undefined): string {
  return value?.trim() ?? '';
}
