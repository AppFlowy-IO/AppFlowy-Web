import { debounce } from 'lodash-es';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { UserService } from '@/application/services/domains';
import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useAppConfig } from '@/components/main/app.hooks';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import { getErrorMessage } from '@/utils/errors';

export function ProfilePanel() {
  const { t } = useTranslation();
  const { currentUser, updateCurrentUser } = useAppConfig();
  const currentWorkspaceId = useCurrentWorkspaceId();

  const [name, setName] = useState(currentUser?.name ?? '');
  const [description, setDescription] = useState('');
  const initializedRef = useRef(false);
  const currentUserRef = useRef(currentUser);
  const updateCurrentUserRef = useRef(updateCurrentUser);

  useEffect(() => {
    currentUserRef.current = currentUser;
    updateCurrentUserRef.current = updateCurrentUser;
  }, [currentUser, updateCurrentUser]);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    let cancelled = false;

    void (async () => {
      try {
        const profile = await UserService.getWorkspaceMemberProfile(currentWorkspaceId);

        if (cancelled || initializedRef.current) return;
        setName(profile.name ?? currentUserRef.current?.name ?? '');
        setDescription(profile.description ?? '');
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
      debounce(async (workspaceId: string, payload: { name: string; description: string }) => {
        try {
          await UserService.updateWorkspaceMemberProfile(workspaceId, payload);
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

  const nameRef = useRef(name);
  const descriptionRef = useRef(description);

  useEffect(() => {
    nameRef.current = name;
    descriptionRef.current = description;
  }, [name, description]);

  const persist = useCallback(
    (next: { name?: string; description?: string }) => {
      if (!currentWorkspaceId) return;
      const payload = {
        name: next.name ?? nameRef.current,
        description: next.description ?? descriptionRef.current,
      };

      void debouncedSave(currentWorkspaceId, payload);
    },
    [currentWorkspaceId, debouncedSave]
  );

  const handleNameChange = useCallback(
    (value: string) => {
      setName(value);
      persist({ name: value });
    },
    [persist]
  );

  const handleDescriptionChange = useCallback(
    (value: string) => {
      setDescription(value);
      persist({ description: value });
    },
    [persist]
  );

  if (!currentUser) return null;

  const initial = (name || currentUser.name || currentUser.email || '?').charAt(0).toUpperCase();

  return (
    <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='border-b border-border-primary px-8 py-5'>
        <h2 className='text-xl font-semibold text-text-primary'>
          {t('settings.accountPage.profile.title')}
        </h2>
      </div>
      <div className='appflowy-scroller flex-1 overflow-y-auto px-8 py-6'>
        <div className='flex flex-col gap-6'>
          <div className='flex items-center gap-4'>
            <Avatar size='xl'>
              <AvatarImage src={currentUser.avatar ?? ''} alt={name} />
              <AvatarFallback name={name}>{initial}</AvatarFallback>
            </Avatar>
            <div className='flex flex-1 flex-col gap-1'>
              <Label htmlFor='profile-display-name'>
                {t('settings.accountPage.profile.displayName')}
              </Label>
              <Input
                id='profile-display-name'
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                data-testid='profile-display-name-input'
              />
            </div>
          </div>

          <div className='flex flex-col gap-1'>
            <Label htmlFor='profile-about-me'>
              {t('settings.accountPage.profile.aboutMe')}
            </Label>
            <TextareaAutosize
              id='profile-about-me'
              size='md'
              minRows={4}
              maxRows={10}
              className='py-2'
              value={description}
              placeholder={t('settings.accountPage.profile.aboutMePlaceholder')}
              onChange={(e) => handleDescriptionChange(e.target.value)}
              data-testid='profile-about-me-textarea'
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProfilePanel;
