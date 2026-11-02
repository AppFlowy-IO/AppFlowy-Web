import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { Role } from '@/application/types';
import { isSameUserUid } from '@/application/user-uid';
import { useCurrentWorkspaceId, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { useIsOfficialHosted } from '@/components/app/hooks/useServerInfo';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { canManageWorkspaceBilling } from '@/utils/subscription';

import { entitlementForStatus, getPresentationStatus } from './presentation-client';

import type { PresentationStatus } from './server-contract';

/** Presentation accounting and deployment policy come from the owning server. */
export function usePresentationAccess(enabled = true) {
  const workspaceId = useCurrentWorkspaceId();
  const info = useUserWorkspaceInfo();
  const user = useCurrentUserOptional();
  const workspace = info?.workspaces.find((item) => item.id === workspaceId);
  const isOwner = workspace?.role === Role.Owner || isSameUserUid(workspace?.owner?.uid, user?.uid);
  const isHosted = useIsOfficialHosted();
  const [, setSearch] = useSearchParams();
  const identity = `${workspaceId}:${user?.uid}`;
  const [result, setResult] = useState<{ identity: string; status?: PresentationStatus; error?: string }>();
  const request = useRef<AbortController>();
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();

    request.current = controller;
    try {
      if (!workspaceId) throw new Error('Select a workspace before opening presentations.');
      const status = await getPresentationStatus({ workspaceId }, controller.signal);

      if (!controller.signal.aborted) setResult({ identity, status });
      return status;
    } catch (error) {
      if (!controller.signal.aborted)
        setResult({ identity, error: error instanceof Error ? error.message : 'Unable to load presentation access.' });
      throw error;
    }
  }, [workspaceId, identity]);

  useEffect(() => {
    setResult(undefined);
    if (enabled && workspaceId) void refresh().catch(() => undefined);
    return () => request.current?.abort();
  }, [enabled, workspaceId, refresh]);

  const onUpgrade = useCallback(async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    if (!canManageWorkspaceBilling(workspace, user?.uid, isHosted)) {
      toast.info('Ask your workspace owner to upgrade to Pro.');
      return;
    }

    setSearch((previous) => {
      previous.set('action', 'change_plan');
      return previous;
    });
  }, [workspace, user?.uid, isHosted, setSearch]);
  const current = enabled && result?.identity === identity ? result : undefined;
  const entitlement = current?.status ? entitlementForStatus(current.status) : undefined;

  return {
    status: current?.status,
    entitlement,
    refresh,
    onUpgrade,
    isPro: entitlement?.isPro ?? false,
    // Ownership and company-style plan access are separate. Owners can still remove styles
    // after a downgrade; only company configuration saves require the paid capability.
    canManageStyles: isOwner,
    isLoading: enabled && !current,
    hasError: !!current?.error,
    error: current?.error,
  };
}
