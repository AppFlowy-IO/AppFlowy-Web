import { debounce } from 'lodash-es';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { FileService, UserService } from '@/application/services/domains';
import { MentionablePerson, MentionPersonRole } from '@/application/types';
import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useAppConfig } from '@/components/main/app.hooks';
import { getErrorMessage } from '@/utils/errors';

import { Banner, bannerFromUrl, bannerToUrl, DEFAULT_BANNER } from './banner';

const SAVE_DEBOUNCE_MS = 500;

type RoleLabelKey = 'settings.appearance.members.guest' | 'settings.appearance.members.member' | null;

export interface ProfileDraft {
  name: string;
  aboutMe: string;
  avatar: string;
  /** What is actually displayed as the banner. */
  banner: Banner;
  /** The last uploaded image, remembered even while a wallpaper is selected. */
  customBanner: Banner | null;
}

const EMPTY_DRAFT: ProfileDraft = {
  name: '',
  aboutMe: '',
  avatar: '',
  banner: DEFAULT_BANNER,
  customBanner: null,
};

export function useProfileSetting() {
  const { currentUser, updateCurrentUser } = useAppConfig();
  const workspaceId = useCurrentWorkspaceId();

  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_DRAFT);
  const [profile, setProfile] = useState<MentionablePerson | null>(null);
  const [loading, setLoading] = useState(true);

  const draftRef = useRef(draft);
  const currentUserRef = useRef(currentUser);
  const updateCurrentUserRef = useRef(updateCurrentUser);
  // Writes are chained so a debounced text save can never land after a later
  // immediate avatar/banner save and resurrect stale values.
  const pendingWriteRef = useRef<Promise<void>>(Promise.resolve());
  const initializedRef = useRef(false);

  useEffect(() => {
    currentUserRef.current = currentUser;
    updateCurrentUserRef.current = updateCurrentUser;
  }, [currentUser, updateCurrentUser]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;

    void (async () => {
      try {
        const fetched = await UserService.getWorkspaceMemberProfile(workspaceId);

        if (cancelled || initializedRef.current) return;

        const loaded: ProfileDraft = {
          name: fetched.name ?? currentUserRef.current?.name ?? '',
          aboutMe: fetched.description ?? '',
          avatar: fetched.avatar_url ?? currentUserRef.current?.avatar ?? '',
          banner: bannerFromUrl(fetched.cover_image_url),
          customBanner: fetched.custom_image_url ? { kind: 'network', url: fetched.custom_image_url } : null,
        };

        setProfile(fetched);
        // Keep the ref in lockstep with state here and in `update`, so saves always
        // read the newest draft without needing a separate sync effect.
        draftRef.current = loaded;
        setDraft(loaded);
        initializedRef.current = true;
      } catch (e) {
        if (!cancelled) toast.error(getErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const persist = useCallback((wsId: string, next: ProfileDraft) => {
    // An empty display name is rejected by the server, so keep the last valid one.
    if (!next.name.trim()) return pendingWriteRef.current;

    pendingWriteRef.current = pendingWriteRef.current
      .catch(() => undefined)
      .then(async () => {
        // Always send the whole record: the backend upsert replaces every column,
        // so an omitted field is nulled out rather than left alone.
        await UserService.updateWorkspaceMemberProfile(wsId, {
          name: next.name.trim(),
          avatar_url: next.avatar || undefined,
          cover_image_url: bannerToUrl(next.banner) || undefined,
          custom_image_url: next.customBanner ? bannerToUrl(next.customBanner) : undefined,
          description: next.aboutMe.trim() || undefined,
        });

        const user = currentUserRef.current;

        if (user && user.name !== next.name.trim()) {
          await updateCurrentUserRef.current({ ...user, name: next.name.trim() });
        }
      })
      .catch((e) => {
        toast.error(getErrorMessage(e));
      });

    return pendingWriteRef.current;
  }, []);

  const debouncedPersist = useMemo(
    () => debounce((wsId: string, next: ProfileDraft) => void persist(wsId, next), SAVE_DEBOUNCE_MS),
    [persist]
  );

  useEffect(() => {
    return () => {
      debouncedPersist.flush();
    };
  }, [debouncedPersist]);

  /** Text fields save on a debounce; avatar and banner save immediately, as on desktop. */
  const update = useCallback(
    (patch: Partial<ProfileDraft>, immediate = false) => {
      const next = { ...draftRef.current, ...patch };

      draftRef.current = next;
      setDraft(next);

      if (!workspaceId) return;

      if (immediate) {
        debouncedPersist.cancel();
        void persist(workspaceId, next);
      } else {
        debouncedPersist(workspaceId, next);
      }
    },
    [debouncedPersist, persist, workspaceId]
  );

  const uploadAction = useCallback(
    async (file: File) => {
      if (!workspaceId) throw new Error('No workspace');
      // Profile images have no parent view, so the workspace id doubles as the blob
      // parent dir — the same convention the desktop app uses.
      return FileService.upload(workspaceId, workspaceId, file);
    },
    [workspaceId]
  );

  const roleLabelKey = useMemo((): RoleLabelKey => {
    switch (profile?.role) {
      case MentionPersonRole.Guest:
        return 'settings.appearance.members.guest';
      case MentionPersonRole.Member:
        return 'settings.appearance.members.member';
      default:
        return null;
    }
  }, [profile?.role]);

  return {
    draft,
    loading,
    email: profile?.email ?? currentUser?.email ?? '',
    roleLabelKey,
    update,
    uploadAction,
  };
}

export default useProfileSetting;
