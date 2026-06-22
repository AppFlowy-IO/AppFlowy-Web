import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AccessLevel, IPeopleWithAccessType, WorkspaceGroupViewPermission } from '@/application/types';
import { findAncestors, findView } from '@/components/_shared/outline/utils';
import { useAppOutline, useCurrentWorkspaceId, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { AccessService } from '@/application/services/domains';
import { resolveShareSectionType, ShareSectionType } from '@/components/app/share/shareSectionType';
import { useCurrentUser } from '@/components/main/app.hooks';

export function useShareAccessDetails(viewId: string, opened: boolean) {
  const currentUser = useCurrentUser();
  const currentUserEmail = currentUser?.email;
  const currentWorkspaceId = useCurrentWorkspaceId();
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const outline = useAppOutline();
  const [people, setPeople] = useState<IPeopleWithAccessType[]>([]);
  const [groups, setGroups] = useState<WorkspaceGroupViewPermission[]>([]);
  const [isLoadingPeople, setIsLoadingPeople] = useState(false);
  const [hasLoadedPeople, setHasLoadedPeople] = useState(false);
  const [loadedPeopleViewId, setLoadedPeopleViewId] = useState<string | null>(null);
  const loadPeopleRequestSeq = useRef(0);

  const loadPeople = useCallback(
    async (signal?: AbortSignal) => {
      if (!currentWorkspaceId || !viewId || !currentUserEmail) {
        return;
      }

      const ancestorViewIds = findAncestors(outline || [], viewId)?.map((item) => item.view_id) || [];
      const requestSeq = ++loadPeopleRequestSeq.current;

      setIsLoadingPeople(true);
      setHasLoadedPeople(false);
      try {
        const detail = await AccessService.getShareDetail(currentWorkspaceId, viewId, ancestorViewIds, signal);

        if (signal?.aborted || requestSeq !== loadPeopleRequestSeq.current) return;
        setPeople(detail.shared_with);
        setGroups(detail.groups ?? []);
        setHasLoadedPeople(true);
        setLoadedPeopleViewId(viewId);
      } catch (error) {
        if (signal?.aborted || requestSeq !== loadPeopleRequestSeq.current) return;
        console.error(error);
        setPeople([]);
        setGroups([]);
        setHasLoadedPeople(false);
        setLoadedPeopleViewId(null);
      } finally {
        if (!signal?.aborted && requestSeq === loadPeopleRequestSeq.current) {
          setIsLoadingPeople(false);
        }
      }
    },
    [currentUserEmail, currentWorkspaceId, viewId, outline]
  );

  useEffect(() => {
    if (!opened) return;

    const controller = new AbortController();

    void loadPeople(controller.signal);
    return () => controller.abort();
  }, [loadPeople, opened]);

  const outlineView = useMemo(() => findView(outline || [], viewId), [outline, viewId]);
  const peopleForCurrentView = useMemo(
    () => (loadedPeopleViewId === viewId ? people : []),
    [loadedPeopleViewId, people, viewId]
  );
  const groupsForCurrentView = useMemo(
    () => (loadedPeopleViewId === viewId ? groups : []),
    [groups, loadedPeopleViewId, viewId]
  );
  const currentUserAccessLevel = useMemo(() => {
    return (
      peopleForCurrentView.find((person) => person.email === currentUserEmail)?.access_level ?? outlineView?.access_level
    );
  }, [currentUserEmail, outlineView?.access_level, peopleForCurrentView]);
  const sectionType = useMemo(() => {
    if (!hasLoadedPeople || loadedPeopleViewId !== viewId) {
      return ShareSectionType.Unknown;
    }

    return resolveShareSectionType({
      outline: outline || [],
      viewId,
      sharedPeople: peopleForCurrentView,
      sharedGroups: groupsForCurrentView,
      workspaceMemberCount: userWorkspaceInfo?.selectedWorkspace?.memberCount,
    });
  }, [
    hasLoadedPeople,
    loadedPeopleViewId,
    outline,
    peopleForCurrentView,
    groupsForCurrentView,
    userWorkspaceInfo?.selectedWorkspace?.memberCount,
    viewId,
  ]);

  return {
    people: peopleForCurrentView,
    groups: groupsForCurrentView,
    isLoadingPeople,
    loadPeople,
    currentUserAccessLevel,
    hasFullAccess: currentUserAccessLevel === AccessLevel.FullAccess,
    sectionType,
  };
}
