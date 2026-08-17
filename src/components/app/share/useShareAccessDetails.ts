import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
import { AccessService, WorkspaceService } from '@/application/services/domains';
import {
  AccessLevel,
  IPeopleWithAccessType,
  ObjectPermission,
  Role,
  SpaceVisibility,
  WorkspaceGroupViewPermission,
} from '@/application/types';
import { findAncestors, findView } from '@/components/_shared/outline/utils';
import {
  useAppOutline,
  useCurrentWorkspaceId,
  useEventEmitter,
  useUserWorkspaceInfo,
} from '@/components/app/app.hooks';
import { resolveCurrentUserAccessLevel } from '@/components/app/share/shareAccessLevel';
import { resolveShareSectionType, ShareSectionType } from '@/components/app/share/shareSectionType';
import { useCurrentUser } from '@/components/main/app.hooks';

const ACCESS_DETAILS_MAX_TRANSIENT_RETRIES = 1;
const ACCESS_DETAILS_DEFAULT_RETRY_MS = 300;
const ACCESS_DETAILS_MAX_RETRY_MS = 3_000;

const ACCESS_DETAILS_DENIED_CODES = new Set<number>([
  ERROR_CODE.RECORD_NOT_FOUND,
  ERROR_CODE.NOT_LOGGED_IN,
  ERROR_CODE.NOT_HAS_PERMISSION,
  ERROR_CODE.USER_UNAUTHORIZED,
  401,
  403,
  404,
]);

const ACCESS_DETAILS_TRANSIENT_CODES = new Set<number>([
  ERROR_CODE.RETRY_LATER,
  ERROR_CODE.SERVICE_TEMPORARY_UNAVAILABLE,
  ERROR_CODE.REQUEST_TIMEOUT,
  ERROR_CODE.TOO_MANY_REQUESTS,
]);

interface AccessDetailsError {
  code?: number;
  retryAfterSecs?: number;
}

export interface ShareAccessRefreshResult {
  effectiveGroups: WorkspaceGroupViewPermission[];
  directGroups: WorkspaceGroupViewPermission[];
  effectiveGroupsLoaded: boolean;
  directGroupsLoaded: boolean;
}

interface DirectGroupSnapshot {
  viewId: string;
  groups: WorkspaceGroupViewPermission[];
  loaded: boolean;
}

type FullAccessAuthorityContext =
  | { kind: 'unknown' }
  | { kind: 'private' }
  | { kind: 'space'; spaceId: string; publicCanManage: boolean }
  | { kind: 'public'; canManage: boolean };

interface FullAccessAuthorityResolution {
  canManage: boolean;
  acceptsLegacyCreatorSignals: boolean;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function sameUserId(first: string | number | null | undefined, second: string | number | null | undefined) {
  return first !== undefined && first !== null && second !== undefined && second !== null && String(first) === String(second);
}

function resolveFullAccessAuthorityContext({
  ancestry,
  currentUserId,
  workspaceRole,
}: {
  ancestry: ReturnType<typeof findAncestors>;
  currentUserId?: string | null;
  workspaceRole?: Role;
}): FullAccessAuthorityContext {
  if (!ancestry || ancestry.length === 0) return { kind: 'unknown' };

  const realSpace = ancestry.find(
    (view) => (view.is_space === true || view.extra?.is_space === true) && !view.extra?.is_hidden_space
  );

  if (realSpace) {
    return {
      kind: 'space',
      spaceId: realSpace.view_id,
      publicCanManage:
        workspaceRole === Role.Owner || ancestry.some((view) => sameUserId(view.created_by, currentUserId)),
    };
  } else if (ancestry.some((view) => view.is_private)) {
    // Legacy private sections do not expose an owner capability through the
    // structured-space endpoint. Fail closed rather than inferring ownership.
    return { kind: 'private' };
  }

  return {
    kind: 'public',
    canManage:
      workspaceRole === Role.Owner || ancestry.some((view) => sameUserId(view.created_by, currentUserId)),
  };
}

function parseAccessDetailsError(error: unknown): AccessDetailsError {
  if (typeof error !== 'object' || error === null) return {};

  const candidate = error as { code?: unknown; retryAfterSecs?: unknown };

  return {
    code: typeof candidate.code === 'number' ? candidate.code : undefined,
    retryAfterSecs: typeof candidate.retryAfterSecs === 'number' ? candidate.retryAfterSecs : undefined,
  };
}

function retryDelayMs(error: AccessDetailsError, retryIndex: number) {
  if (error.retryAfterSecs !== undefined) {
    return Math.min(error.retryAfterSecs * 1_000, ACCESS_DETAILS_MAX_RETRY_MS);
  }

  return Math.min(ACCESS_DETAILS_DEFAULT_RETRY_MS * 2 ** retryIndex, ACCESS_DETAILS_MAX_RETRY_MS);
}

function waitBeforeRetry(delayMs: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  if (delayMs <= 0) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;

    function finish(shouldRetry: boolean) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', handleAbort);
      resolve(shouldRetry);
    }

    function handleAbort() {
      finish(false);
    }

    const timeoutId = setTimeout(() => finish(true), delayMs);

    signal?.addEventListener('abort', handleAbort, { once: true });

    // Cover an abort racing with listener registration.
    if (signal?.aborted) handleAbort();
  });
}

export function useShareAccessDetails(viewId: string, opened: boolean) {
  const currentUser = useCurrentUser();
  const currentUserEmail = currentUser?.email;
  const currentWorkspaceId = useCurrentWorkspaceId();
  const eventEmitter = useEventEmitter();
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const outline = useAppOutline();
  const [people, setPeople] = useState<IPeopleWithAccessType[]>([]);
  const [groups, setGroups] = useState<WorkspaceGroupViewPermission[]>([]);
  const [directGroups, setDirectGroups] = useState<WorkspaceGroupViewPermission[]>([]);
  const [directGroupsLoaded, setDirectGroupsLoaded] = useState(false);
  const directGroupSnapshotRef = useRef<DirectGroupSnapshot>({ viewId, groups: [], loaded: false });
  const [isLoadingPeople, setIsLoadingPeople] = useState(false);
  const [hasLoadedPeople, setHasLoadedPeople] = useState(false);
  const [loadedPeopleViewId, setLoadedPeopleViewId] = useState<string | null>(null);
  const [currentUserPermission, setCurrentUserPermission] = useState<ObjectPermission | null>(null);
  const [fullAccessAuthority, setFullAccessAuthority] = useState({ viewId, canManage: false });
  const [deniedViewId, setDeniedViewId] = useState<string | null>(null);
  const loadPeopleRequestSeq = useRef(0);
  const pendingRevocations = useRef<{ viewId: string; emails: Map<string, number> }>({
    viewId,
    emails: new Map(),
  });
  const pendingGroupUpdates = useRef<{
    viewId: string;
    updates: Map<string, { accessLevel: AccessLevel | null; requestSeq: number }>;
  }>({
    viewId,
    updates: new Map(),
  });
  const viewAncestry = useMemo(() => findAncestors(outline || [], viewId), [outline, viewId]);
  const ancestorViewIds = useMemo(() => viewAncestry?.map((item) => item.view_id) || [], [viewAncestry]);
  const fullAccessAuthorityContext = useMemo(
    () =>
      resolveFullAccessAuthorityContext({
        ancestry: viewAncestry,
        currentUserId: currentUser?.uid,
        workspaceRole: userWorkspaceInfo?.selectedWorkspace?.role,
      }),
    [currentUser?.uid, userWorkspaceInfo?.selectedWorkspace?.role, viewAncestry]
  );

  if (directGroupSnapshotRef.current.viewId !== viewId) {
    directGroupSnapshotRef.current = { viewId, groups: [], loaded: false };
  }

  const loadPeople = useCallback(
    async (signal?: AbortSignal) => {
      if (!currentWorkspaceId || !viewId || !currentUserEmail) {
        return;
      }

      const requestSeq = ++loadPeopleRequestSeq.current;
      // Start independent reads together. Effective access controls what is
      // displayed, direct grants control which rows may be edited here, and a
      // governing-space policy identifies the owner tier protected by Full
      // Access mutations even if the outline projection is stale.
      const directGroupsPromise = Promise.allSettled([AccessService.getSharedGroups(currentWorkspaceId, viewId)]).then(
        ([result]) => result
      );
      const fullAccessAuthorityPromise: Promise<FullAccessAuthorityResolution> =
        fullAccessAuthorityContext.kind === 'space'
          ? WorkspaceService.getSpacePermission(currentWorkspaceId, fullAccessAuthorityContext.spaceId)
              .then((permission) => {
                const isPrivate = permission.permission.visibility === SpaceVisibility.Private;

                return {
                  canManage: isPrivate ? permission.can_manage_space : fullAccessAuthorityContext.publicCanManage,
                  acceptsLegacyCreatorSignals: !isPrivate,
                };
              })
              .catch(() => ({ canManage: false, acceptsLegacyCreatorSignals: false }))
          : Promise.resolve({
              canManage:
                fullAccessAuthorityContext.kind === 'public' ? fullAccessAuthorityContext.canManage : false,
              acceptsLegacyCreatorSignals: fullAccessAuthorityContext.kind === 'public',
            });

      setIsLoadingPeople(true);

      try {
        for (let retryIndex = 0; retryIndex <= ACCESS_DETAILS_MAX_TRANSIENT_RETRIES; retryIndex += 1) {
          try {
            const detail = await AccessService.getShareDetail(currentWorkspaceId, viewId, ancestorViewIds, signal);
            const [directGroupResult, resolvedFullAccessAuthority] = await Promise.all([
              directGroupsPromise,
              fullAccessAuthorityPromise,
            ]);

            if (signal?.aborted || requestSeq !== loadPeopleRequestSeq.current) return;

            const previousDirectGroupSnapshot = directGroupSnapshotRef.current;
            const canReuseDirectGroupSnapshot =
              previousDirectGroupSnapshot.viewId === viewId && previousDirectGroupSnapshot.loaded;
            const directGroupSnapshot =
              directGroupResult.status === 'fulfilled'
                ? directGroupResult.value
                : canReuseDirectGroupSnapshot
                ? previousDirectGroupSnapshot.groups
                : [];
            const hasLoadedDirectGroups = directGroupResult.status === 'fulfilled';

            if (pendingRevocations.current.viewId !== viewId) {
              pendingRevocations.current = { viewId, emails: new Map() };
            }

            if (pendingGroupUpdates.current.viewId !== viewId) {
              pendingGroupUpdates.current = { viewId, updates: new Map() };
            }

            const revokedEmails = pendingRevocations.current.emails;
            const groupUpdates = pendingGroupUpdates.current.updates;

            // Filter only requests that were already in flight when the revoke
            // completed. A later request starts after cache invalidation and is
            // authoritative, so it can also surface a legitimate re-share.
            const visiblePeople = detail.shared_with.filter((person) => {
              const revokedAtRequestSeq = revokedEmails.get(normalizeEmail(person.email));

              return revokedAtRequestSeq === undefined || requestSeq > revokedAtRequestSeq;
            });

            for (const [email, revokedAtRequestSeq] of revokedEmails) {
              if (requestSeq > revokedAtRequestSeq) revokedEmails.delete(email);
            }

            // Some deployments can omit direct rows from effective details. Keep
            // them visible, then let the effective response win for duplicate
            // group IDs, matching Desktop's direct/effective merge semantics.
            const effectiveGroupsById = new Map(directGroupSnapshot.map((group) => [group.group_id, group] as const));

            for (const group of detail.groups ?? []) {
              effectiveGroupsById.set(group.group_id, group);
            }

            const visibleGroups = Array.from(effectiveGroupsById.values()).reduce<WorkspaceGroupViewPermission[]>(
              (current, group) => {
                const pendingUpdate = groupUpdates.get(group.group_id);

                if (!pendingUpdate || requestSeq > pendingUpdate.requestSeq) {
                  current.push(group);
                } else if (pendingUpdate.accessLevel !== null) {
                  current.push({ ...group, access_level: pendingUpdate.accessLevel });
                }

                return current;
              },
              []
            );

            for (const [groupId, pendingUpdate] of groupUpdates) {
              if (requestSeq > pendingUpdate.requestSeq) groupUpdates.delete(groupId);
            }

            setPeople(visiblePeople);
            setGroups(visibleGroups);
            if (hasLoadedDirectGroups) {
              directGroupSnapshotRef.current = { viewId, groups: directGroupSnapshot, loaded: true };
              setDirectGroups(directGroupSnapshot);
              setDirectGroupsLoaded(true);
            } else if (!canReuseDirectGroupSnapshot) {
              directGroupSnapshotRef.current = { viewId, groups: [], loaded: false };
              setDirectGroups([]);
              setDirectGroupsLoaded(false);
            }

            setCurrentUserPermission(detail.current_user_permission ?? null);
            setFullAccessAuthority({
              viewId,
              canManage:
                resolvedFullAccessAuthority.canManage ||
                (resolvedFullAccessAuthority.acceptsLegacyCreatorSignals &&
                  (detail.current_user_permission?.object_creator === true ||
                    detail.current_user_permission?.ancestor_creator === true)),
            });
            setDeniedViewId(null);
            setHasLoadedPeople(true);
            setLoadedPeopleViewId(viewId);
            return {
              effectiveGroups: visibleGroups,
              directGroups: directGroupSnapshot,
              effectiveGroupsLoaded: true,
              directGroupsLoaded:
                hasLoadedDirectGroups || (canReuseDirectGroupSnapshot && previousDirectGroupSnapshot.loaded),
            } satisfies ShareAccessRefreshResult;
          } catch (error) {
            if (signal?.aborted || requestSeq !== loadPeopleRequestSeq.current) return;

            const accessDetailsError = parseAccessDetailsError(error);

            if (accessDetailsError.code !== undefined && ACCESS_DETAILS_DENIED_CODES.has(accessDetailsError.code)) {
              pendingRevocations.current.emails.clear();
              pendingGroupUpdates.current = { viewId, updates: new Map() };
              setPeople([]);
              setGroups([]);
              directGroupSnapshotRef.current = { viewId, groups: [], loaded: false };
              setDirectGroups([]);
              setDirectGroupsLoaded(false);
              setCurrentUserPermission(null);
              setFullAccessAuthority({ viewId, canManage: false });
              setDeniedViewId(viewId);
              setHasLoadedPeople(false);
              setLoadedPeopleViewId(viewId);
              return;
            }

            const canRetry =
              accessDetailsError.code !== undefined &&
              ACCESS_DETAILS_TRANSIENT_CODES.has(accessDetailsError.code) &&
              retryIndex < ACCESS_DETAILS_MAX_TRANSIENT_RETRIES;

            if (!canRetry) {
              // Keep the last confirmed list for transient and unknown failures.
              console.error(error);
              return;
            }

            const shouldRetry = await waitBeforeRetry(retryDelayMs(accessDetailsError, retryIndex), signal);

            if (!shouldRetry || requestSeq !== loadPeopleRequestSeq.current) return;
            AccessService.invalidateShareDetailCache(currentWorkspaceId);
          }
        }
      } finally {
        if (!signal?.aborted && requestSeq === loadPeopleRequestSeq.current) {
          setIsLoadingPeople(false);
        }
      }
    },
    [ancestorViewIds, currentUserEmail, currentWorkspaceId, fullAccessAuthorityContext, viewId]
  );

  useEffect(() => {
    if (!opened) return;

    const controller = new AbortController();

    void loadPeople(controller.signal);
    return () => controller.abort();
  }, [loadPeople, opened]);

  useEffect(() => {
    if (!opened || !eventEmitter || !currentWorkspaceId) return;

    const controller = new AbortController();
    const handleShareViewsChanged = (payload?: { viewId?: string | null }) => {
      const changedViewId = payload?.viewId;

      // Sharing an ancestor can change effective access for this view. Payloads
      // without an ID are refreshed conservatively for older servers.
      if (changedViewId && changedViewId !== viewId && !ancestorViewIds.includes(changedViewId)) return;

      AccessService.invalidateShareDetailCache(currentWorkspaceId);
      void loadPeople(controller.signal);
    };

    const handlePermissionChanged = () => {
      // Group grants and membership changes use this broader notification, so
      // they cannot be safely filtered to a view from the event payload. The
      // always-mounted workspace layer invalidates access details and reloads
      // the outline synchronously; defer this panel-only row refresh until all
      // event listeners have observed the notification.
      queueMicrotask(() => {
        if (!controller.signal.aborted) void loadPeople(controller.signal);
      });
    };

    eventEmitter.on(APP_EVENTS.SHARE_VIEWS_CHANGED, handleShareViewsChanged);
    eventEmitter.on(APP_EVENTS.PERMISSION_CHANGED, handlePermissionChanged);
    return () => {
      controller.abort();
      eventEmitter.off(APP_EVENTS.SHARE_VIEWS_CHANGED, handleShareViewsChanged);
      eventEmitter.off(APP_EVENTS.PERMISSION_CHANGED, handlePermissionChanged);
    };
  }, [ancestorViewIds, currentWorkspaceId, eventEmitter, loadPeople, opened, viewId]);

  const removePersonFromAccessList = useCallback(
    (email: string) => {
      const normalizedEmail = normalizeEmail(email);

      if (pendingRevocations.current.viewId !== viewId) {
        pendingRevocations.current = { viewId, emails: new Map() };
      }

      pendingRevocations.current.emails.set(normalizedEmail, loadPeopleRequestSeq.current);
      setPeople((currentPeople) => currentPeople.filter((person) => normalizeEmail(person.email) !== normalizedEmail));

      if (normalizedEmail === normalizeEmail(currentUserEmail || '')) {
        setCurrentUserPermission(null);
        setDeniedViewId(viewId);
        setHasLoadedPeople(false);
      }
    },
    [currentUserEmail, viewId]
  );

  const updateGroupInAccessList = useCallback(
    (groupId: string, accessLevel: AccessLevel | null) => {
      if (pendingGroupUpdates.current.viewId !== viewId) {
        pendingGroupUpdates.current = { viewId, updates: new Map() };
      }

      pendingGroupUpdates.current.updates.set(groupId, {
        accessLevel,
        requestSeq: loadPeopleRequestSeq.current,
      });
      setGroups((currentGroups) => {
        if (accessLevel === null) {
          return currentGroups.filter((group) => group.group_id !== groupId);
        }

        return currentGroups.map((group) =>
          group.group_id === groupId ? { ...group, access_level: accessLevel } : group
        );
      });
      // The mutation response confirms the direct grant, so retain that
      // snapshot if a subsequent direct-grant refresh fails.
      const currentDirectSnapshot = directGroupSnapshotRef.current;
      const directSnapshotWasLoaded = currentDirectSnapshot.viewId === viewId && currentDirectSnapshot.loaded;
      const updatedDirectGroups =
        accessLevel === null
          ? currentDirectSnapshot.groups.filter((group) => group.group_id !== groupId)
          : currentDirectSnapshot.groups.map((group) =>
              group.group_id === groupId ? { ...group, access_level: accessLevel } : group
            );

      directGroupSnapshotRef.current = {
        viewId,
        groups: updatedDirectGroups,
        loaded: directSnapshotWasLoaded,
      };
      setDirectGroups(updatedDirectGroups);
      setDirectGroupsLoaded(directSnapshotWasLoaded);
    },
    [viewId]
  );

  const outlineView = useMemo(() => findView(outline || [], viewId), [outline, viewId]);
  const peopleForCurrentView = useMemo(
    () => (loadedPeopleViewId === viewId ? people : []),
    [loadedPeopleViewId, people, viewId]
  );
  const groupsForCurrentView = useMemo(
    () => (loadedPeopleViewId === viewId ? groups : []),
    [groups, loadedPeopleViewId, viewId]
  );
  const directGroupsForCurrentView = useMemo(
    () => (loadedPeopleViewId === viewId ? directGroups : []),
    [directGroups, loadedPeopleViewId, viewId]
  );
  const editableGroupIds = useMemo(() => {
    if (!directGroupsLoaded || loadedPeopleViewId !== viewId) return new Set<string>();

    const effectiveAccessByGroupId = new Map(
      groupsForCurrentView.map((group) => [group.group_id, group.access_level] as const)
    );

    return new Set(
      directGroupsForCurrentView
        .filter((group) => effectiveAccessByGroupId.get(group.group_id) === group.access_level)
        .map((group) => group.group_id)
    );
  }, [directGroupsForCurrentView, directGroupsLoaded, groupsForCurrentView, loadedPeopleViewId, viewId]);
  const currentUserPermissionForCurrentView = loadedPeopleViewId === viewId ? currentUserPermission : null;
  const accessDetailsDenied = deniedViewId === viewId;
  const canManageFullAccess =
    hasLoadedPeople && loadedPeopleViewId === viewId && fullAccessAuthority.viewId === viewId
      ? fullAccessAuthority.canManage
      : false;
  const currentUserAccessLevel = useMemo(() => {
    if (accessDetailsDenied) return undefined;

    return resolveCurrentUserAccessLevel({
      currentUserEmail,
      currentUserPermission: currentUserPermissionForCurrentView,
      outlineAccessLevel: outlineView?.access_level,
      sharedPeople: peopleForCurrentView,
    });
  }, [
    accessDetailsDenied,
    currentUserEmail,
    currentUserPermissionForCurrentView,
    outlineView?.access_level,
    peopleForCurrentView,
  ]);
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
    editableGroupIds,
    isLoadingPeople,
    loadPeople,
    removePersonFromAccessList,
    updateGroupInAccessList,
    currentUserAccessLevel,
    hasFullAccess: currentUserAccessLevel === AccessLevel.FullAccess,
    canManageFullAccess,
    sectionType,
  };
}
