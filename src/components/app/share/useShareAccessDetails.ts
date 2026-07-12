import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
import { AccessService } from '@/application/services/domains';
import { AccessLevel, IPeopleWithAccessType, ObjectPermission } from '@/application/types';
import { findAncestors, findView } from '@/components/_shared/outline/utils';
import { useAppOutline, useCurrentWorkspaceId, useEventEmitter, useUserWorkspaceInfo } from '@/components/app/app.hooks';
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

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
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
  const [isLoadingPeople, setIsLoadingPeople] = useState(false);
  const [hasLoadedPeople, setHasLoadedPeople] = useState(false);
  const [loadedPeopleViewId, setLoadedPeopleViewId] = useState<string | null>(null);
  const [currentUserPermission, setCurrentUserPermission] = useState<ObjectPermission | null>(null);
  const [deniedViewId, setDeniedViewId] = useState<string | null>(null);
  const loadPeopleRequestSeq = useRef(0);
  const pendingRevocations = useRef<{ viewId: string; emails: Map<string, number> }>({
    viewId,
    emails: new Map(),
  });
  const ancestorViewIds = useMemo(
    () => findAncestors(outline || [], viewId)?.map((item) => item.view_id) || [],
    [outline, viewId]
  );

  const loadPeople = useCallback(
    async (signal?: AbortSignal) => {
      if (!currentWorkspaceId || !viewId || !currentUserEmail) {
        return;
      }

      const requestSeq = ++loadPeopleRequestSeq.current;

      setIsLoadingPeople(true);

      try {
        for (let retryIndex = 0; retryIndex <= ACCESS_DETAILS_MAX_TRANSIENT_RETRIES; retryIndex += 1) {
          try {
            const detail = await AccessService.getShareDetail(currentWorkspaceId, viewId, ancestorViewIds, signal);

            if (signal?.aborted || requestSeq !== loadPeopleRequestSeq.current) return;

            if (pendingRevocations.current.viewId !== viewId) {
              pendingRevocations.current = { viewId, emails: new Map() };
            }

            const revokedEmails = pendingRevocations.current.emails;

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

            setPeople(visiblePeople);
            setCurrentUserPermission(detail.current_user_permission ?? null);
            setDeniedViewId(null);
            setHasLoadedPeople(true);
            setLoadedPeopleViewId(viewId);
            return;
          } catch (error) {
            if (signal?.aborted || requestSeq !== loadPeopleRequestSeq.current) return;

            const accessDetailsError = parseAccessDetailsError(error);

            if (accessDetailsError.code !== undefined && ACCESS_DETAILS_DENIED_CODES.has(accessDetailsError.code)) {
              pendingRevocations.current.emails.clear();
              setPeople([]);
              setCurrentUserPermission(null);
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
    [ancestorViewIds, currentUserEmail, currentWorkspaceId, viewId]
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

    eventEmitter.on(APP_EVENTS.SHARE_VIEWS_CHANGED, handleShareViewsChanged);
    return () => {
      controller.abort();
      eventEmitter.off(APP_EVENTS.SHARE_VIEWS_CHANGED, handleShareViewsChanged);
    };
  }, [ancestorViewIds, currentWorkspaceId, eventEmitter, loadPeople, opened, viewId]);

  const removePersonFromAccessList = useCallback(
    (email: string) => {
      const normalizedEmail = normalizeEmail(email);

      if (pendingRevocations.current.viewId !== viewId) {
        pendingRevocations.current = { viewId, emails: new Map() };
      }

      pendingRevocations.current.emails.set(normalizedEmail, loadPeopleRequestSeq.current);
      setPeople((currentPeople) =>
        currentPeople.filter((person) => normalizeEmail(person.email) !== normalizedEmail)
      );

      if (normalizedEmail === normalizeEmail(currentUserEmail || '')) {
        setCurrentUserPermission(null);
        setDeniedViewId(viewId);
        setHasLoadedPeople(false);
      }
    },
    [currentUserEmail, viewId]
  );

  const outlineView = useMemo(() => findView(outline || [], viewId), [outline, viewId]);
  const peopleForCurrentView = useMemo(
    () => (loadedPeopleViewId === viewId ? people : []),
    [loadedPeopleViewId, people, viewId]
  );
  const currentUserPermissionForCurrentView = loadedPeopleViewId === viewId ? currentUserPermission : null;
  const accessDetailsDenied = deniedViewId === viewId;
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
      workspaceMemberCount: userWorkspaceInfo?.selectedWorkspace?.memberCount,
    });
  }, [
    hasLoadedPeople,
    loadedPeopleViewId,
    outline,
    peopleForCurrentView,
    userWorkspaceInfo?.selectedWorkspace?.memberCount,
    viewId,
  ]);

  return {
    people: peopleForCurrentView,
    isLoadingPeople,
    loadPeople,
    removePersonFromAccessList,
    currentUserAccessLevel,
    hasFullAccess: currentUserAccessLevel === AccessLevel.FullAccess,
    sectionType,
  };
}
