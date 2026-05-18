import { useCallback, useEffect, useRef, useState } from 'react';

import { useDatabase, useDatabaseViewId } from '@/application/database-yjs';
import {
  FormShareInfo,
  FormShareTier,
  FormSubmissionAccess,
  getFormShare,
  mintFormShare,
  patchFormShare,
} from '@/application/services/js-services/http';
import { YjsDatabaseKey } from '@/application/types';
import { useCurrentWorkspaceIdOptional } from '@/components/app/app.hooks';

function coerceSubmissionAccess(
  tier: FormShareTier,
  anonymous: boolean,
  requested: FormSubmissionAccess,
): FormSubmissionAccess {
  if (tier === 'public') return 'none';
  if (anonymous) return 'none';
  return requested;
}

/**
 * Mirror of the desktop's `FormShareController`. Owns the cloud-side
 * share token (tier / anonymous / submission_access) for the current
 * form view and proxies mutations to the cloud HTTP API.
 *
 * On bootstrap it calls `mintFormShare` with no body — the cloud's
 * mint endpoint is idempotent against an active token (returns 409 if
 * one exists), so we fall back to `getFormShare` on conflict. The two
 * paths converge on the same `FormShareInfo` shape.
 *
 * Invariant coercion mirrors `coerce_submission_access` in
 * `appflowy-cloud/src/biz/forms/share.rs` — the UI hides rows that
 * the server would collapse, so the user never sees a button that
 * does nothing.
 */
export interface FormShareState {
  info: FormShareInfo | null;
  isLoading: boolean;
  error: string | null;
  setTier: (tier: FormShareTier) => Promise<void>;
  setAnonymous: (value: boolean) => Promise<void>;
  setSubmissionAccess: (access: FormSubmissionAccess) => Promise<void>;
  /// Web-facing share URL the user copies. Falls back to a view-id URL
  /// when no token is available (local-server mode, or pre-bootstrap).
  resolveShareUrl: () => string;
}

export function useFormShare(): FormShareState {
  const viewId = useDatabaseViewId();
  const database = useDatabase();
  const workspaceId = useCurrentWorkspaceIdOptional();
  const databaseId = database?.get(YjsDatabaseKey.id) as string | undefined;

  const [info, setInfo] = useState<FormShareInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  // Bootstrap order:
  //   1. GET the existing token (cheap, idempotent — most common case
  //      after desktop has already minted).
  //   2. If GET returns null (form hasn't been shared yet anywhere),
  //      POST to mint with privacy-by-default.
  //   3. Race: if mint hits 409 (another tab/client minted between
  //      our GET and POST), fall back to GET to read the new row.
  //
  // This replaces the "mint-and-swallow-409" pattern that left `info`
  // null when the desktop had already minted — the popover would then
  // render server-default placeholders until the user made any change.
  //
  // Cancellation: when the view-id flips (user switches tabs), the
  // previous bootstrap is still in flight. A late response would
  // overwrite the new view's state — guard with a per-effect cancel
  // flag so only the latest bootstrap can call setState.
  useEffect(() => {
    if (!viewId || !databaseId || !workspaceId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    setIsLoading(true);
    void (async () => {
      try {
        const existing = await getFormShare(workspaceId, databaseId, viewId);

        if (cancelled) return;
        if (existing) {
          setInfo(existing);
          setError(null);
          return;
        }

        const minted = await mintFormShare(workspaceId, databaseId, viewId);

        if (cancelled) return;
        setInfo(minted);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        const message = (e as { message?: string })?.message ?? 'load failed';

        if (/already exists|409/i.test(message)) {
          try {
            const existing = await getFormShare(workspaceId, databaseId, viewId);

            if (cancelled) return;
            if (existing) {
              setInfo(existing);
              setError(null);
              return;
            }
          } catch {
            // Fall through to the original error path.
          }
        }

        if (cancelled) return;
        setError(message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [databaseId, viewId, workspaceId]);

  const patch = useCallback(
    async (delta: {
      tier?: FormShareTier;
      anonymous?: boolean;
      submission_access?: FormSubmissionAccess;
    }) => {
      if (!viewId || !databaseId || !workspaceId) return;
      if (busy.current) return; // race guard
      busy.current = true;
      try {
        const next = await patchFormShare(
          workspaceId,
          databaseId,
          viewId,
          delta,
        );

        setInfo(next);
        setError(null);
      } catch (e) {
        const message = (e as { message?: string })?.message ?? 'patch failed';

        setError(message);
      } finally {
        busy.current = false;
      }
    },
    [databaseId, viewId, workspaceId],
  );

  const setTier = useCallback(
    async (tier: FormShareTier) => {
      if (!info) return;
      const anonymous = tier === 'public' ? true : info.anonymous;
      const submission_access = coerceSubmissionAccess(
        tier,
        anonymous,
        info.submission_access,
      );

      await patch({ tier, anonymous, submission_access });
    },
    [info, patch],
  );

  const setAnonymous = useCallback(
    async (value: boolean) => {
      if (!info) return;
      if (info.tier === 'public') return; // cloud forces it
      // Auto-promote tier→Public when Anonymous flips ON under Workspace.
      // "Anonymous" colloquially means "anyone can fill out"; without
      // this the share link would still 401 anonymous traffic and the
      // toggle would feel like a no-op. Mirror of the desktop
      // `FormShareController.setAnonymous` promotion rule.
      const promoteTier = value && info.tier === 'workspace';
      const nextTier: FormShareTier = promoteTier ? 'public' : info.tier;
      const submission_access = coerceSubmissionAccess(
        nextTier,
        value,
        info.submission_access,
      );
      const delta: {
        tier?: FormShareTier;
        anonymous: boolean;
        submission_access: FormSubmissionAccess;
      } = { anonymous: value, submission_access };

      if (promoteTier) delta.tier = 'public';

      await patch(delta);
    },
    [info, patch],
  );

  const setSubmissionAccess = useCallback(
    async (access: FormSubmissionAccess) => {
      if (!info) return;
      const coerced = coerceSubmissionAccess(info.tier, info.anonymous, access);

      await patch({ submission_access: coerced });
    },
    [info, patch],
  );

  const resolveShareUrl = useCallback(() => {
    // Prefer the server-computed URL (built from `APPFLOWY_WEB_URL`).
    // This is the same URL the desktop reads — single source of truth
    // across all clients.
    if (info?.share_url) return info.share_url;
    // Fallbacks (in priority order):
    //   1. Same-origin guess: web is hosted alongside the cloud, so
    //      `{origin}/form/{token}` resolves to our own FormPage route.
    //      Works in local dev and single-host self-hosts.
    //   2. View id placeholder: pre-token state — gives the creator
    //      something identifiable to paste even before the bootstrap
    //      completes.
    const base = `${window.location.origin}/form`;
    const token = info?.token;

    if (!token) return `${base}/${viewId ?? ''}`;
    return `${base}/${token}`;
  }, [info, viewId]);

  return {
    info,
    isLoading,
    error,
    setTier,
    setAnonymous,
    setSubmissionAccess,
    resolveShareUrl,
  };
}
