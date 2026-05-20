import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ERROR_CODE } from '@/application/constants';
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

/**
 * Why an error from the share bootstrap matters to the UI:
 *   - `plan_required` — the cloud's `is_workspace_on_paid_plan` gate
 *     refused. Surface an upgrade prompt instead of the loading skeleton
 *     so Free workspaces don't see a blank popover (regression image #41).
 *   - `other` — network failure, permission, transient cloud error. Keep
 *     a generic message; the user can retry by closing and reopening.
 */
export type FormShareErrorKind = 'plan_required' | 'other';

function classifyError(err: unknown): FormShareErrorKind {
  const e = err as { code?: number; message?: string } | null | undefined;

  // Server contract: `FeatureNotAvailable` (1067) is the gate refusal.
  // Message-substring fallback is paranoia for older cloud builds that
  // might surface the gate as a different code; the message text is
  // pinned by `share.rs` and changes only via deliberate edit.
  if (e?.code === ERROR_CODE.FEATURE_NOT_AVAILABLE) return 'plan_required';
  if (e?.message && /Pro or Team plan/i.test(e.message)) return 'plan_required';
  return 'other';
}

/**
 * Errors that warrant a retry rather than a final-state UI commit.
 * The cloud's `check_form_view_scope` rejects with `RecordNotFound`
 * when a freshly-created form view hasn't propagated to its folder-
 * cache lookup yet (the view exists in YJS / collab, but the cache
 * lags by a beat). That's a transient race, not a real failure —
 * retrying with backoff lets the cache catch up.
 *
 * `FeatureNotAvailable` is deliberately NOT in this set: a Free
 * workspace will keep getting the same answer no matter how long we
 * wait, so a retry would just add latency before the upgrade prompt.
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type BootstrapOutcome =
  | { kind: 'success'; info: FormShareInfo }
  | { kind: 'failure'; error: unknown };

/**
 * One GET-then-mint attempt against the cloud. The caller wraps this
 * in a retry loop because some failures are transient (folder cache
 * race on a freshly-created form view).
 *
 * Returns `success` when either the GET produced a token, the mint
 * succeeded, or the mint hit 409 and the follow-up GET picked up the
 * existing token. `failure` carries the last error untouched so the
 * caller can classify (plan_required vs transient vs other) and
 * decide whether to retry.
 */
async function tryBootstrap(
  workspaceId: string,
  databaseId: string,
  viewId: string,
): Promise<BootstrapOutcome> {
  try {
    const existing = await getFormShare(workspaceId, databaseId, viewId);

    if (existing) return { kind: 'success', info: existing };
  } catch (e) {
    // Fall through to mint — mint carries the authoritative answer.
    // eslint-disable-next-line no-console
    console.debug('[useFormShare] GET failed, falling through to mint', e);
  }

  try {
    const minted = await mintFormShare(workspaceId, databaseId, viewId);

    return { kind: 'success', info: minted };
  } catch (e) {
    const message = (e as { message?: string })?.message ?? 'mint failed';

    // 409 = a token already exists (race between our GET and POST).
    // Re-fetch to pick it up.
    if (/already exists|409/i.test(message)) {
      try {
        const after = await getFormShare(workspaceId, databaseId, viewId);

        if (after) return { kind: 'success', info: after };
      } catch {
        // Fall through to the failure branch.
      }
    }

    return { kind: 'failure', error: e };
  }
}

function isTransientError(err: unknown): boolean {
  const e = err as { code?: number; message?: string } | null | undefined;

  // RECORD_NOT_FOUND (-2) is the canonical "the cloud doesn't see
  // this view yet" signal. NetworkError / -1 also retries — covers
  // the case where the user opened the popover while offline for a
  // second.
  if (e?.code === ERROR_CODE.RECORD_NOT_FOUND) return true;

  if (e?.code === -1) return true;

  if (e?.message && /not found|view.*does not exist/i.test(e.message)) {
    return true;
  }

  return false;
}

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
  /// Distinguishes a plan-gate refusal from a generic failure so the
  /// popover can render an upgrade prompt instead of an infinite
  /// loading skeleton (regression image #41).
  errorKind: FormShareErrorKind | null;
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
  const [errorKind, setErrorKind] = useState<FormShareErrorKind | null>(null);
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
      // GET-first path. Cheap when another client has already minted —
      // most common case after the first session. Failures fall
      // through to mint, which carries the authoritative answer
      // (plan-gate refusal / success / actual server error).
      //
      // Both GET and mint depend on `check_form_view_scope` server-
      // side, which rejects with `RecordNotFound` when a freshly-
      // created form view hasn't propagated to the folder cache yet
      // (regression image #43: "Couldn't load share settings"
      // appearing on a brand-new form view). That's a transient race
      // — retry the whole bootstrap a handful of times with backoff
      // before surfacing as a final-state error.
      const MAX_ATTEMPTS = 5;
      const BACKOFF_MS = [250, 500, 1000, 1500, 2000];
      let lastError: unknown = null;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        if (cancelled) return;
        const outcome = await tryBootstrap(workspaceId, databaseId, viewId);

        if (cancelled) return;
        if (outcome.kind === 'success') {
          setInfo(outcome.info);
          setError(null);
          setErrorKind(null);
          setIsLoading(false);
          return;
        }

        lastError = outcome.error;

        // `plan_required` is terminal — retrying won't help a Free
        // workspace; commit the upgrade prompt immediately so the
        // user can act on it.
        if (classifyError(outcome.error) === 'plan_required') {
          break;
        }

        if (!isTransientError(outcome.error)) {
          // Non-transient, non-plan-gate error (auth, 5xx, etc.)
          // — break out so we don't burn the user's time on a hopeless
          // retry loop.
          break;
        }

        const delay = BACKOFF_MS[attempt] ?? 2000;

        // eslint-disable-next-line no-console
        console.debug(
          `[useFormShare] bootstrap attempt ${attempt + 1} hit transient error; retrying in ${delay}ms`,
          outcome.error,
        );
        await wait(delay);
      }

      if (cancelled) return;
      const message =
        (lastError as { message?: string })?.message ?? 'load failed';
      const kind = classifyError(lastError);

      // eslint-disable-next-line no-console
      console.warn('[useFormShare] bootstrap failed after retries', {
        kind,
        error: lastError,
      });
      setError(message);
      setErrorKind(kind);
      setIsLoading(false);
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
        setErrorKind(null);
      } catch (e) {
        const message = (e as { message?: string })?.message ?? 'patch failed';

        setError(message);
        setErrorKind(classifyError(e));
      } finally {
        busy.current = false;
      }
    },
    [databaseId, viewId, workspaceId],
  );

  const setTier = useCallback(
    async (tier: FormShareTier) => {
      if (!info) return;
      // Anonymous coercion is intentionally minimal — Notion-parity
      // model (Image #51): the toggle controls anonymous, the picker
      // controls tier, they do not bleed.
      //   * Public → forces anonymous=true (cloud also forces it; the
      //     respondent doesn't carry a session, so identity stamping
      //     is mechanically impossible). Mirror it client-side so the
      //     UI never shows a stale snapshot.
      //   * Workspace / Closed → preserve `info.anonymous`. A
      //     workspace-only form that hides respondent identity is a
      //     valid combination (e.g. anonymous team surveys); flipping
      //     tier through the picker must not silently re-identify
      //     submissions.
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
      // No tier promotion — Notion-parity. Anonymous under Workspace
      // tier is a first-class state (image #51: signed-in workspace
      // members submit, but their identity is not recorded in the
      // Respondent column). The earlier auto-promote-to-Public rule
      // was incorrect: it surfaced a Public form for users who
      // explicitly wanted Workspace + Anonymous (and triggered the
      // image #48 confusion when they switched back).
      const submission_access = coerceSubmissionAccess(
        info.tier,
        value,
        info.submission_access,
      );

      await patch({ anonymous: value, submission_access });
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

  // Memo the returned object so `FormShareProvider`'s context value has a
  // stable identity across renders that didn't actually change anything.
  // Without this, every parent re-render hands consumers a fresh object —
  // forcing `FormShareButton`, `FormAccessBanner`, and the popover subtree
  // to re-render even when info/setters are unchanged.
  return useMemo(
    () => ({
      info,
      isLoading,
      error,
      errorKind,
      setTier,
      setAnonymous,
      setSubmissionAccess,
      resolveShareUrl,
    }),
    [info, isLoading, error, errorKind, setTier, setAnonymous, setSubmissionAccess, resolveShareUrl],
  );
}
