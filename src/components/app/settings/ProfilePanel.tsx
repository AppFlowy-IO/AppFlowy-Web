import { debounce } from 'lodash-es';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { UserService } from '@/application/services/domains';
import { MentionablePerson } from '@/application/types';
import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useAppConfig } from '@/components/main/app.hooks';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getErrorMessage } from '@/utils/errors';

export function ProfilePanel() {
  const { t } = useTranslation();
  const { currentUser, updateCurrentUser } = useAppConfig();
  const currentWorkspaceId = useCurrentWorkspaceId();

  const [name, setName] = useState(currentUser?.name ?? '');
  const [profile, setProfile] = useState<MentionablePerson | null>(null);
  const initializedRef = useRef(false);
  const currentUserRef = useRef(currentUser);
  const updateCurrentUserRef = useRef(updateCurrentUser);
  const profileRef = useRef<MentionablePerson | null>(null);

  useEffect(() => {
    currentUserRef.current = currentUser;
    updateCurrentUserRef.current = updateCurrentUser;
  }, [currentUser, updateCurrentUser]);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    let cancelled = false;

    void (async () => {
      try {
        const fetched = await UserService.getWorkspaceMemberProfile(currentWorkspaceId);

        if (cancelled || initializedRef.current) return;
        setProfile(fetched);
        setName(fetched.name ?? currentUserRef.current?.name ?? '');
        initializedRef.current = true;
      } catch (e) {
        if (!cancelled) toast.error(getErrorMessage(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentWorkspaceId]);

  const debouncedSave = useMemo(
    () =>
      // Preserve sibling profile fields — the backend upsert overwrites every
      // column, so omitting avatar_url/description/etc. would null them out.
      debounce(async (workspaceId: string, payload: { name: string }) => {
        try {
          const current = profileRef.current;

          await UserService.updateWorkspaceMemberProfile(workspaceId, {
            name: payload.name,
            avatar_url: current?.avatar_url ?? undefined,
            cover_image_url: current?.cover_image_url ?? undefined,
            custom_image_url: current?.custom_image_url ?? undefined,
            description: current?.description ?? undefined,
          });
          const u = currentUserRef.current;

          if (u) {
            await updateCurrentUserRef.current({ ...u, name: payload.name });
          }
        } catch (e) {
          toast.error(getErrorMessage(e));
        }
      }, 500),
    []
  );

  useEffect(() => {
    return () => {
      void debouncedSave.flush();
    };
  }, [debouncedSave]);

  const handleNameChange = useCallback(
    (value: string) => {
      setName(value);
      if (!currentWorkspaceId) return;
      void debouncedSave(currentWorkspaceId, { name: value });
    },
    [currentWorkspaceId, debouncedSave]
  );

  if (!currentUser) return null;

  const initial = (name || currentUser.name || currentUser.email || '?').charAt(0).toUpperCase();
  const avatar = profile?.avatar_url ?? currentUser.avatar ?? '';
  const isInlineAvatar =
    avatar.length > 0 &&
    !avatar.startsWith('http://') &&
    !avatar.startsWith('https://') &&
    !avatar.startsWith('/') &&
    !avatar.startsWith('data:') &&
    !avatar.startsWith('blob:');

  return (
    <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='border-b border-border-primary px-8 py-5'>
        <h2 className='text-xl font-semibold text-text-primary'>{t('settings.accountPage.profile.title')}</h2>
      </div>
      <div className='appflowy-scroller flex-1 overflow-y-auto px-8 py-6'>
        <div className='flex flex-col gap-6'>
          <div className='flex items-center gap-4'>
            <Avatar size='xl'>
              <AvatarImage src={isInlineAvatar ? '' : avatar} alt={name} />
              <AvatarFallback name={name}>
                {isInlineAvatar ? <span className='text-2xl'>{avatar}</span> : initial}
              </AvatarFallback>
            </Avatar>
            <div className='flex flex-1 flex-col gap-1'>
              <Label htmlFor='profile-display-name'>{t('settings.accountPage.profile.displayName')}</Label>
              <Input
                id='profile-display-name'
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                data-testid='profile-display-name-input'
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProfilePanel;
