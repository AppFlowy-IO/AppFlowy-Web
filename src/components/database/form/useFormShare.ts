import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

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
 *     a generic message and expose an explicit retry action.
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

type BootstrapOutcome = { kind: 'success'; info: FormShareInfo } | { kind: 'failure'; error: unknown };

type FormShareDelta = {
  tier?: FormShareTier;
  anonymous?: boolean;
  submission_access?: FormSubmissionAccess;
};

interface FormShareMutationScope {
  key: string;
  workspaceId: string | undefined;
  databaseId: string | undefined;
  viewId: string | undefined;
  active: boolean;
  confirmed: FormShareInfo | null;
  desired: FormShareInfo | null;
  revision: number;
  confirmedRevision: number;
  pendingRequest: FormShareDelta;
  pendingOptimistic: FormShareDelta;
  draining: Promise<void> | null;
}

function createMutationScope(
  key: string,
  workspaceId: string | undefined,
  databaseId: string | undefined,
  viewId: string | undefined
): FormShareMutationScope {
  return {
    key,
    workspaceId,
    databaseId,
    viewId,
    active: true,
    confirmed: null,
    desired: null,
    revision: 0,
    confirmedRevision: 0,
    pendingRequest: {},
    pendingOptimistic: {},
    draining: null,
  };
}

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
async function tryBootstrap(workspaceId: string, databaseId: string, viewId: string): Promise<BootstrapOutcome> {
  try {
    const existing = await getFormShare(workspaceId, databaseId, viewId);

    if (existing) return { kind: 'success', info: existing };
  } catch (e) {
    // Never turn a failed read into a write. Auth, permission, network, and
    // server failures must be surfaced/retried as reads; mint is valid only
    // after a successful GET authoritatively reports no existing share.
    return { kind: 'failure', error: e };
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

function isViewPropagationError(err: unknown): boolean {
  const e = err as { code?: number; message?: string } | null | undefined;

  // RECORD_NOT_FOUND (-2) is the canonical "the cloud doesn't see this view
  // yet" signal. Axios already retries transport failures, so code -1 must be
  // surfaced for an explicit user retry instead of starting a second backoff
  // loop here.
  if (e?.code === ERROR_CODE.RECORD_NOT_FOUND) return true;

  // Older cloud builds did not consistently attach the canonical code. Keep a
  // narrow message fallback that requires the error to identify the view.
  if (e?.message && /view.*(?:not found|does not exist)|(?:not found|does not exist).*view/i.test(e.message)) {
    return true;
  }

  return false;
}

function coerceSubmissionAccess(
  tier: FormShareTier,
  anonymous: boolean,
  requested: FormSubmissionAccess
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
  /** Re-runs bootstrap for the current form after a terminal load failure. */
  retryBootstrap: () => void;
  setTier: (tier: FormShareTier) => Promise<void>;
  setAnonymous: (value: boolean) => Promise<void>;
  setSubmissionAccess: (access: FormSubmissionAccess) => Promise<void>;
  /// Server-computed Web share URL, or an empty string when the deployment
  /// has not configured `APPFLOWY_WEB_URL`.
  resolveShareUrl: () => string;
}

export function useFormShare(): FormShareState {
  const viewId = useDatabaseViewId();
  const database = useDatabase();
  const workspaceId = useCurrentWorkspaceIdOptional();
  const databaseId = database?.get(YjsDatabaseKey.id) as string | undefined;
  const scopeKey = `${workspaceId ?? ''}\u0000${databaseId ?? ''}\u0000${viewId ?? ''}`;
  const mutationScopeRef = useRef<FormShareMutationScope | null>(null);
  const mutationScope = useMemo(
    () => createMutationScope(scopeKey, workspaceId, databaseId, viewId),
    [databaseId, scopeKey, viewId, workspaceId]
  );

  const [info, setInfo] = useState<FormShareInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<FormShareErrorKind | null>(null);
  const [stateScopeKey, setStateScopeKey] = useState(scopeKey);
  const [bootstrapRevision, setBootstrapRevision] = useState(0);

  const retryBootstrap = useCallback(() => {
    const scope = mutationScopeRef.current;

    if (!scope?.active || !scope.workspaceId || !scope.databaseId || !scope.viewId) return;

    // Commit loading synchronously with the interaction. The effect generation
    // below still owns the request and cancellation lifecycle, so a retry cannot
    // bypass the Form-to-Form scope guards.
    setStateScopeKey(scope.key);
    setError(null);
    setErrorKind(null);
    setIsLoading(true);
    setBootstrapRevision((revision) => revision + 1);
  }, []);

  // A Form-to-Form switch can reuse this hook instance. Rotate the request
  // scope before paint/user events, without mutating refs during a potentially
  // abandoned concurrent render.
  useLayoutEffect(() => {
    const previous = mutationScopeRef.current;

    if (previous && previous !== mutationScope) previous.active = false;
    mutationScope.active = true;
    mutationScopeRef.current = mutationScope;

    return () => {
      mutationScope.active = false;
    };
  }, [mutationScope]);

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
    const scope = mutationScope;

    if (mutationScopeRef.current !== scope) return;
    scope.active = true;
    setStateScopeKey(scopeKey);

    if (!viewId || !databaseId || !workspaceId) {
      setInfo(null);
      setError(null);
      setErrorKind(null);
      setIsLoading(false);
      return () => {
        scope.active = false;
      };
    }

    let cancelled = false;

    // Reset the prior view's state before bootstrap. Without this, switching
    // directly between Form tabs would briefly render the previous form's
    // token/tier in the new popover (and let the user copy/patch it) because
    // the share controls render whenever `info !== null` — the loading
    // spinner never gets a chance to show. Errors get cleared for the same
    // reason: a stale "couldn't load share settings" toast must not survive
    // a successful bootstrap of a different form.
    setInfo(null);
    setError(null);
    setErrorKind(null);
    setIsLoading(true);
    void (async () => {
      // GET-first path. Cheap when another client has already minted —
      // most common case after the first session. Only a successful empty
      // read proceeds to mint; failed reads stay read-only and are classified
      // or retried below.
      //
      // Both GET and mint depend on `check_form_view_scope` server-
      // side, which rejects with `RecordNotFound` when a freshly-
      // created form view hasn't propagated to the folder cache yet
      // (regression image #43: "Couldn't load share settings"
      // appearing on a brand-new form view). That's a transient race
      // — retry the whole bootstrap a handful of times with backoff
      // before surfacing as a final-state error.
      const MAX_ATTEMPTS = 5;
      const BACKOFF_MS = [250, 500, 1000, 1500];
      let lastError: unknown = null;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        if (cancelled || mutationScopeRef.current !== scope || !scope.active) return;
        const outcome = await tryBootstrap(workspaceId, databaseId, viewId);

        if (cancelled || mutationScopeRef.current !== scope || !scope.active) return;
        if (outcome.kind === 'success') {
          scope.confirmed = outcome.info;
          scope.desired = outcome.info;
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

        if (!isViewPropagationError(outcome.error)) {
          // Non-transient, non-plan-gate error (auth, 5xx, etc.)
          // — break out so we don't burn the user's time on a hopeless
          // retry loop.
          break;
        }

        // There is no next attempt after the final failure. Break immediately
        // rather than making the user wait through a backoff that cannot lead to
        // another request.
        if (attempt + 1 >= MAX_ATTEMPTS) break;

        const delay = BACKOFF_MS[attempt] ?? 1500;

        // eslint-disable-next-line no-console
        console.debug(
          `[useFormShare] bootstrap attempt ${attempt + 1} hit transient error; retrying in ${delay}ms`,
          outcome.error
        );
        await wait(delay);
      }

      if (cancelled || mutationScopeRef.current !== scope || !scope.active) return;
      const message = (lastError as { message?: string })?.message ?? 'load failed';
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
      scope.active = false;
    };
  }, [bootstrapRevision, databaseId, mutationScope, scopeKey, viewId, workspaceId]);

  const patch = useCallback((requestDelta: FormShareDelta, optimisticDelta = requestDelta): Promise<void> => {
    const scope = mutationScopeRef.current;

    if (
      !scope?.active ||
      !scope.workspaceId ||
      !scope.databaseId ||
      !scope.viewId ||
      !scope.confirmed ||
      !scope.desired
    ) {
      return Promise.resolve();
    }

    const mutationWorkspaceId = scope.workspaceId;
    const mutationDatabaseId = scope.databaseId;
    const mutationViewId = scope.viewId;

    // Apply invariant-derived values immediately for responsive UI, while
    // retaining only the fields the user actually changed for PATCH. Sparse
    // requests keep a desktop or another tab's unrelated concurrent setting.
    scope.desired = { ...scope.desired, ...optimisticDelta };
    scope.pendingRequest = { ...scope.pendingRequest, ...requestDelta };
    scope.pendingOptimistic = { ...scope.pendingOptimistic, ...optimisticDelta };
    scope.revision += 1;
    setInfo(scope.desired);
    setError(null);
    setErrorKind(null);

    if (scope.draining) return scope.draining;

    const drainPromise = (async () => {
      // A nullable PATCH response means the token disappeared between the
      // initial bootstrap and this mutation (for example, another client
      // revoked it). Recover at most once per drain so a revoke loop cannot
      // spin forever.
      let recoveredMissingToken = false;

      while (
        mutationScopeRef.current === scope &&
        scope.active &&
        scope.confirmed &&
        scope.desired &&
        scope.confirmedRevision < scope.revision
      ) {
        const revision = scope.revision;
        const request = scope.pendingRequest;
        const optimistic = scope.pendingOptimistic;

        scope.pendingRequest = {};
        scope.pendingOptimistic = {};

        try {
          const next = await patchFormShare(mutationWorkspaceId, mutationDatabaseId, mutationViewId, request);

          if (mutationScopeRef.current !== scope || !scope.active) return;

          if (next === null) {
            if (recoveredMissingToken) {
              const missingError = {
                message: 'The form share token changed again. Reload share settings and retry.',
              };

              scope.confirmed = null;
              scope.desired = null;
              scope.pendingRequest = {};
              scope.pendingOptimistic = {};
              scope.confirmedRevision = scope.revision;
              setInfo(null);
              setError(missingError.message);
              setErrorKind('other');
              return;
            }

            recoveredMissingToken = true;
            // The vanished token never received this request. Reapply only
            // the user's sparse intent to the replacement token; later input
            // wins field-by-field while bootstrap is in flight.
            scope.pendingRequest = { ...request, ...scope.pendingRequest };
            scope.pendingOptimistic = { ...optimistic, ...scope.pendingOptimistic };
            const recovered = await tryBootstrap(mutationWorkspaceId, mutationDatabaseId, mutationViewId);

            if (mutationScopeRef.current !== scope || !scope.active) return;
            if (recovered.kind === 'failure') {
              const message =
                (recovered.error as { message?: string })?.message ?? 'reload failed after the share token changed';

              // The prior confirmation points at a token the server has told
              // us is gone. Clear it instead of rolling the optimistic state
              // back to a stale URL. The popover exposes retryBootstrap.
              scope.confirmed = null;
              scope.desired = null;
              scope.pendingRequest = {};
              scope.pendingOptimistic = {};
              scope.confirmedRevision = scope.revision;
              setInfo(null);
              setError(message);
              setErrorKind(classifyError(recovered.error));
              return;
            }

            scope.confirmed = recovered.info;
            scope.desired = {
              ...recovered.info,
              ...scope.pendingOptimistic,
            };
            setInfo(scope.desired);
            setError(null);
            setErrorKind(null);
            // Do not advance confirmedRevision: the recovered token still
            // needs the latest sparse intent applied to it. The next loop
            // iteration performs that PATCH, including choices made while
            // recovery was in flight.
            continue;
          }

          scope.confirmed = next;
          scope.confirmedRevision = revision;
          setError(null);
          setErrorKind(null);

          if (scope.revision === revision) {
            scope.desired = next;
            setInfo(next);
          } else {
            // A later choice arrived while this request was in flight. Keep
            // only that pending optimistic state over the authoritative
            // response; this also adopts unrelated concurrent server changes.
            scope.desired = { ...next, ...scope.pendingOptimistic };
            setInfo(scope.desired);
          }
        } catch (e) {
          if (mutationScopeRef.current !== scope || !scope.active) return;

          // If the user made a newer choice, retry the failed sparse fields
          // together with that choice. Newer values win. Otherwise roll the
          // optimistic value back to the last server confirmation.
          if (scope.revision !== revision) {
            scope.pendingRequest = { ...request, ...scope.pendingRequest };
            scope.pendingOptimistic = { ...optimistic, ...scope.pendingOptimistic };
            continue;
          }

          const message = (e as { message?: string })?.message ?? 'patch failed';

          scope.desired = scope.confirmed;
          scope.pendingRequest = {};
          scope.pendingOptimistic = {};
          scope.confirmedRevision = scope.revision;
          setInfo(scope.confirmed);
          setError(message);
          setErrorKind(classifyError(e));
          return;
        }
      }
    })();

    scope.draining = drainPromise;
    void drainPromise.finally(() => {
      if (scope.draining === drainPromise) scope.draining = null;
    });
    return drainPromise;
  }, []);

  const setTier = useCallback(
    async (tier: FormShareTier) => {
      const current = mutationScopeRef.current?.desired;

      if (!current) return;
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
      const anonymous = tier === 'public' ? true : current.anonymous;
      const submission_access = coerceSubmissionAccess(tier, anonymous, current.submission_access);

      await patch({ tier }, { tier, anonymous, submission_access });
    },
    [patch]
  );

  const setAnonymous = useCallback(
    async (value: boolean) => {
      const current = mutationScopeRef.current?.desired;

      if (!current) return;
      if (current.tier === 'public') return; // cloud forces it
      // No tier promotion — Notion-parity. Anonymous under Workspace
      // tier is a first-class state (image #51: signed-in workspace
      // members submit, but their identity is not recorded in the
      // Respondent column). The earlier auto-promote-to-Public rule
      // was incorrect: it surfaced a Public form for users who
      // explicitly wanted Workspace + Anonymous (and triggered the
      // image #48 confusion when they switched back).
      const submission_access = coerceSubmissionAccess(current.tier, value, current.submission_access);

      await patch({ anonymous: value }, { anonymous: value, submission_access });
    },
    [patch]
  );

  const setSubmissionAccess = useCallback(
    async (access: FormSubmissionAccess) => {
      const current = mutationScopeRef.current?.desired;

      if (!current) return;
      const coerced = coerceSubmissionAccess(current.tier, current.anonymous, access);

      await patch({ submission_access: coerced });
    },
    [patch]
  );

  // Passive effects have not run yet on the first render after a tab switch.
  // Hide the previous scope synchronously so its URL/tier cannot flash or be
  // acted on while the new scope bootstraps.
  const stateMatchesScope = stateScopeKey === scopeKey;
  const scopedInfo = stateMatchesScope ? info : null;
  const scopedIsLoading = stateMatchesScope ? isLoading : Boolean(viewId && databaseId && workspaceId);
  const scopedError = stateMatchesScope ? error : null;
  const scopedErrorKind = stateMatchesScope ? errorKind : null;

  const resolveShareUrl = useCallback(() => {
    // Never guess from window.location or substitute a view ID. The server
    // deliberately owns this URL so separate Web/API origins and path-prefix
    // deployments stay correct; an empty value is an operator configuration
    // error that the popover must surface instead of copying a broken link.
    return scopedInfo?.share_url ?? '';
  }, [scopedInfo]);

  // Memo the returned object so `FormShareProvider`'s context value has a
  // stable identity across renders that didn't actually change anything.
  // Without this, every parent re-render hands consumers a fresh object —
  // forcing `FormShareButton`, `FormAccessBanner`, and the popover subtree
  // to re-render even when info/setters are unchanged.
  return useMemo(
    () => ({
      info: scopedInfo,
      isLoading: scopedIsLoading,
      error: scopedError,
      errorKind: scopedErrorKind,
      retryBootstrap,
      setTier,
      setAnonymous,
      setSubmissionAccess,
      resolveShareUrl,
    }),
    [
      scopedInfo,
      scopedIsLoading,
      scopedError,
      scopedErrorKind,
      retryBootstrap,
      setTier,
      setAnonymous,
      setSubmissionAccess,
      resolveShareUrl,
    ]
  );
}
