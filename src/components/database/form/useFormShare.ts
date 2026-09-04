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
import { useAuthenticatedUserIdOptional } from '@/components/main/app.hooks';

/**
 * Errors that warrant a retry rather than a final-state UI commit.
 * The cloud's `check_form_view_scope` rejects with `RecordNotFound`
 * when a freshly-created form view hasn't propagated to its folder-
 * cache lookup yet (the view exists in YJS / collab, but the cache
 * lags by a beat). That's a transient race, not a real failure —
 * retrying with backoff lets the cache catch up.
 *
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type BootstrapOutcome =
  | { kind: 'success'; info: FormShareInfo }
  | { kind: 'empty' }
  | { kind: 'failure'; error: unknown };

type FormShareDelta = {
  tier?: FormShareTier;
  anonymous?: boolean;
  submission_access?: FormSubmissionAccess;
};

interface FormShareMutationScope {
  key: string;
  principalId: string;
  workspaceId: string | undefined;
  databaseId: string | undefined;
  viewId: string | undefined;
  active: boolean;
  owners: Set<symbol>;
  ownerCanUpdateSettings: Map<symbol, boolean>;
  authorityDenied: boolean;
  canPersistMutations: boolean;
  subscribers: Map<symbol, (scope: FormShareMutationScope, bootstrapSettled: boolean) => void>;
  confirmed: FormShareInfo | null;
  desired: FormShareInfo | null;
  revision: number;
  pendingRequest: FormShareDelta;
  pendingOptimistic: FormShareDelta;
  draining: Promise<void> | null;
  mutationError: { message: string } | null;
}

// Process-local outbox keyed by the exact Form share scope. A Form provider is
// unmounted whenever the user switches database tabs, but a PATCH already in
// flight (and the latest choice queued behind it) still belongs to the user's
// durable intent. Retaining the lane lets that drain finish off-screen and lets
// a later mount reclaim/retry a failed final choice, matching Desktop's
// `_FormSharePersistenceOutbox` lifecycle.
const formShareMutationScopes = new Map<string, FormShareMutationScope>();
let formShareMutationPrincipalId: string | undefined;

function hasFormShareDelta(delta: FormShareDelta): boolean {
  return Object.keys(delta).length > 0;
}

function releaseFormShareMutationScope(scope: FormShareMutationScope) {
  if (scope.active || scope.draining || hasFormShareDelta(scope.pendingRequest)) return;
  if (formShareMutationScopes.get(scope.key) === scope) formShareMutationScopes.delete(scope.key);
}

function createMutationScope(
  key: string,
  principalId: string,
  workspaceId: string | undefined,
  databaseId: string | undefined,
  viewId: string | undefined
): FormShareMutationScope {
  return {
    key,
    principalId,
    workspaceId,
    databaseId,
    viewId,
    active: false,
    owners: new Set(),
    ownerCanUpdateSettings: new Map(),
    authorityDenied: false,
    canPersistMutations: false,
    subscribers: new Map(),
    confirmed: null,
    desired: null,
    revision: 0,
    pendingRequest: {},
    pendingOptimistic: {},
    draining: null,
    mutationError: null,
  };
}

function mutationScopeMatches(
  scope: FormShareMutationScope,
  principalId: string,
  workspaceId: string | undefined,
  databaseId: string | undefined,
  viewId: string | undefined
): boolean {
  return (
    scope.principalId === principalId &&
    scope.workspaceId === workspaceId &&
    scope.databaseId === databaseId &&
    scope.viewId === viewId
  );
}

function notifyFormShareMutationScope(scope: FormShareMutationScope, bootstrapSettled = false) {
  scope.subscribers.forEach((subscriber) => subscriber(scope, bootstrapSettled));
}

function retainClosedMutationOnly(scope: FormShareMutationScope) {
  const retainsClosedIntent = scope.pendingRequest.tier === 'closed';

  scope.pendingRequest = retainsClosedIntent ? { tier: 'closed' } : {};
  scope.pendingOptimistic = retainsClosedIntent ? { tier: 'closed' } : {};
  scope.desired = scope.confirmed;
  scope.mutationError = null;
  scope.revision += 1;
}

function refreshMutationAuthority(scope: FormShareMutationScope) {
  // When every provider has unmounted, keep the last observed capability so
  // an accepted write can finish off-screen. An explicit transition to
  // view-only is different: discard access-broadening retries and retain at
  // most a queued Closed handoff, matching Desktop's persistence outbox.
  if (scope.owners.size === 0) return;

  const canPersistMutations =
    !scope.authorityDenied &&
    Array.from(scope.owners).some((owner) => scope.ownerCanUpdateSettings.get(owner) === true);

  if (scope.canPersistMutations === canPersistMutations) return;
  scope.canPersistMutations = canPersistMutations;
  if (!canPersistMutations) retainClosedMutationOnly(scope);
  notifyFormShareMutationScope(scope);
}

function restoreMutationAuthorityAfterSuccessfulRead(
  scope: FormShareMutationScope,
  canUpdateSettings: boolean,
  mutationRevisionAtRequest: number
) {
  // A bootstrap that started before a newer mutation/permission fence cannot
  // prove authority. In particular, `retainClosedMutationOnly` advances this
  // revision when a PATCH receives 401/403, so an older in-flight GET must not
  // re-enable writes after that server-authoritative denial.
  if (scope.revision !== mutationRevisionAtRequest) return;
  if (!canUpdateSettings || !scope.authorityDenied) return;
  scope.authorityDenied = false;
  refreshMutationAuthority(scope);
}

/** Test isolation for the process-local mutation outbox. */
export function resetFormShareMutationOutboxForTesting() {
  invalidateFormShareMutationScopes();
  formShareMutationPrincipalId = undefined;
}

function invalidateFormShareMutationScopes() {
  formShareMutationScopes.forEach((scope) => {
    scope.active = false;
    scope.owners.clear();
    scope.ownerCanUpdateSettings.clear();
    scope.authorityDenied = false;
    scope.canPersistMutations = false;
    scope.subscribers.clear();
    scope.pendingRequest = {};
    scope.pendingOptimistic = {};
    scope.revision += 1;
  });
  formShareMutationScopes.clear();
}

/**
 * One GET-then-mint attempt against the cloud. The caller wraps this
 * in a retry loop because some failures are transient (folder cache
 * race on a freshly-created form view).
 *
 * Returns `success` when either the GET produced a token, the mint
 * succeeded, or the mint hit 409 and the follow-up GET picked up the
 * existing token. `failure` carries the last error untouched so the
 * caller can decide whether to retry.
 */
async function tryBootstrap(
  workspaceId: string,
  databaseId: string,
  viewId: string,
  canMint: boolean | (() => boolean) = true
): Promise<BootstrapOutcome> {
  try {
    const existing = await getFormShare(workspaceId, databaseId, viewId);

    if (existing) return { kind: 'success', info: existing };
    if (!(typeof canMint === 'function' ? canMint() : canMint)) return { kind: 'empty' };
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
    // 409 = a token already exists (race between our GET and POST).
    // Re-fetch to pick it up.
    if (isAlreadyExistsError(e)) {
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

function isAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as {
    code?: unknown;
    httpStatus?: unknown;
    response?: { status?: unknown; data?: { code?: unknown } };
  };

  return (
    candidate.code === ERROR_CODE.RECORD_ALREADY_EXISTS ||
    candidate.response?.data?.code === ERROR_CODE.RECORD_ALREADY_EXISTS ||
    candidate.httpStatus === 409 ||
    candidate.response?.status === 409
  );
}

function isShareAuthorityError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as {
    code?: unknown;
    status?: unknown;
    httpStatus?: unknown;
    response?: { status?: unknown; data?: { code?: unknown } };
  };
  const code = candidate.code ?? candidate.response?.data?.code;
  const status = candidate.httpStatus ?? candidate.status ?? candidate.response?.status;

  return (
    code === ERROR_CODE.NOT_HAS_PERMISSION ||
    code === ERROR_CODE.USER_UNAUTHORIZED ||
    code === ERROR_CODE.NOT_LOGGED_IN ||
    status === 401 ||
    status === 403
  );
}

function validatedShareUrl(info: FormShareInfo | null): string {
  if (!info?.token.trim()) return '';

  const value = info.share_url?.trim();

  if (!value) return '';

  try {
    const url = new URL(value);

    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return '';
    return value;
  } catch {
    return '';
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
  /** Page permission for changing share settings. */
  canUpdateSettings: boolean;
  info: FormShareInfo | null;
  isLoading: boolean;
  error: string | null;
  /** Re-runs bootstrap for the current form after a terminal load failure. */
  retryBootstrap: () => void;
  /** Replays the latest failed share-settings intent without losing it. */
  retryMutation: () => void;
  setTier: (tier: FormShareTier) => Promise<void>;
  setAnonymous: (value: boolean) => Promise<void>;
  setSubmissionAccess: (access: FormSubmissionAccess) => Promise<void>;
  /// Validated server-computed Web share URL, or an empty string when the
  /// response lacks a real token or absolute HTTP(S) respondent URL.
  resolveShareUrl: () => string;
}

export function useFormShare({ canUpdateSettings = true }: { canUpdateSettings?: boolean } = {}): FormShareState {
  const viewId = useDatabaseViewId();
  const database = useDatabase();
  const workspaceId = useCurrentWorkspaceIdOptional();
  const principalId = useAuthenticatedUserIdOptional() ?? 'anonymous';
  const databaseId = database?.get(YjsDatabaseKey.id) as string | undefined;
  const scopeKey = `${principalId}\u0000${workspaceId ?? ''}\u0000${databaseId ?? ''}\u0000${viewId ?? ''}`;
  const mutationScopeRef = useRef<FormShareMutationScope | null>(null);
  const mutationOwner = useMemo(() => Symbol('form-share-mutation-owner'), []);
  const mutationScopeCandidate = useMemo(
    () => createMutationScope(scopeKey, principalId, workspaceId, databaseId, viewId),
    [databaseId, principalId, scopeKey, viewId, workspaceId]
  );
  const [adoptedMutationScope, setAdoptedMutationScope] = useState<FormShareMutationScope | null>(null);
  const mutationScope =
    adoptedMutationScope?.key === scopeKey &&
    mutationScopeMatches(adoptedMutationScope, principalId, workspaceId, databaseId, viewId)
      ? adoptedMutationScope
      : mutationScopeCandidate;

  const [info, setInfo] = useState<FormShareInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authorityDenied, setAuthorityDenied] = useState(false);
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
    setIsLoading(true);
    setBootstrapRevision((revision) => revision + 1);
  }, []);

  const syncMutationScope = useCallback(
    (scope: FormShareMutationScope, bootstrapSettled: boolean) => {
      if (mutationScopeRef.current !== scope) return;
      setInfo(canUpdateSettings ? scope.desired : scope.confirmed);
      setError(canUpdateSettings ? scope.mutationError?.message ?? null : null);
      setAuthorityDenied(scope.authorityDenied);
      if (bootstrapSettled) setIsLoading(false);
    },
    [canUpdateSettings]
  );

  const startMutationDrain = useCallback((scope: FormShareMutationScope): Promise<void> => {
    if (scope.draining) return scope.draining;
    if (
      !scope.canPersistMutations ||
      !scope.workspaceId ||
      !scope.databaseId ||
      !scope.viewId ||
      !scope.confirmed ||
      !scope.desired ||
      !hasFormShareDelta(scope.pendingRequest)
    ) {
      return Promise.resolve();
    }

    const mutationWorkspaceId = scope.workspaceId;
    const mutationDatabaseId = scope.databaseId;
    const mutationViewId = scope.viewId;

    scope.mutationError = null;
    notifyFormShareMutationScope(scope);

    const drainPromise = (async () => {
      // A nullable PATCH response means the token disappeared between the
      // initial bootstrap and this mutation. Recover at most once per drain so
      // a revoke loop cannot spin forever.
      let recoveredMissingToken = false;

      while (
        scope.canPersistMutations &&
        scope.confirmed &&
        scope.desired &&
        hasFormShareDelta(scope.pendingRequest)
      ) {
        const revision = scope.revision;
        const request = scope.pendingRequest;
        const optimistic = scope.pendingOptimistic;

        scope.pendingRequest = {};
        scope.pendingOptimistic = {};

        try {
          const next = await patchFormShare(mutationWorkspaceId, mutationDatabaseId, mutationViewId, request);

          if (next === null) {
            // The vanished token never received this request. Retain the latest
            // sparse intent in the process outbox so a replacement token can
            // receive it now or after this Form remounts.
            scope.pendingRequest = { ...request, ...scope.pendingRequest };
            scope.pendingOptimistic = { ...optimistic, ...scope.pendingOptimistic };

            if (!scope.canPersistMutations) {
              retainClosedMutationOnly(scope);
              notifyFormShareMutationScope(scope);
              return;
            }

            if (recoveredMissingToken) {
              const message = 'The form share token changed again. Reload share settings and retry.';

              scope.confirmed = null;
              scope.desired = null;
              scope.mutationError = { message };
              notifyFormShareMutationScope(scope);

              return;
            }

            recoveredMissingToken = true;
            const recovered = await tryBootstrap(
              mutationWorkspaceId,
              mutationDatabaseId,
              mutationViewId,
              () => scope.canPersistMutations
            );

            if (recovered.kind !== 'success') {
              const recoveryError =
                recovered.kind === 'failure'
                  ? recovered.error
                  : new Error('The replacement form share token is unavailable');
              const message =
                (recoveryError as { message?: string })?.message ?? 'reload failed after the share token changed';

              scope.confirmed = null;
              scope.desired = null;
              scope.mutationError = { message };
              notifyFormShareMutationScope(scope);

              return;
            }

            scope.confirmed = recovered.info;
            scope.desired = {
              ...recovered.info,
              ...scope.pendingOptimistic,
            };
            scope.mutationError = null;
            notifyFormShareMutationScope(scope);

            continue;
          }

          scope.confirmed = next;
          scope.mutationError = null;

          if (scope.revision === revision && !hasFormShareDelta(scope.pendingRequest)) {
            scope.desired = next;
          } else {
            // A later choice arrived while this request was in flight. Keep
            // only that pending optimistic state over the authoritative
            // response; this also adopts unrelated concurrent server changes.
            scope.desired = { ...next, ...scope.pendingOptimistic };
          }

          notifyFormShareMutationScope(scope);
        } catch (cause) {
          const message = (cause as { message?: string })?.message ?? 'patch failed';

          // Preserve the failed request together with any newer queued values.
          // Newer fields win, so Retry always replays the user's final intent.
          scope.pendingRequest = { ...request, ...scope.pendingRequest };
          scope.pendingOptimistic = { ...optimistic, ...scope.pendingOptimistic };
          if (isShareAuthorityError(cause)) {
            // The server is authoritative even if the surrounding permission
            // snapshot has not refreshed yet. Fence further writes now and
            // never retain an access-broadening intent for a later remount.
            scope.authorityDenied = true;
            scope.canPersistMutations = false;
            retainClosedMutationOnly(scope);
          } else if (!scope.canPersistMutations) {
            retainClosedMutationOnly(scope);
          } else {
            scope.desired = scope.confirmed;
            scope.mutationError = { message };
          }

          notifyFormShareMutationScope(scope);

          return;
        }
      }
    })();

    scope.draining = drainPromise;
    void drainPromise.finally(() => {
      if (scope.draining === drainPromise) scope.draining = null;
      releaseFormShareMutationScope(scope);
    });
    return drainPromise;
  }, []);

  const retryMutation = useCallback(() => {
    const scope = mutationScopeRef.current;

    if (!canUpdateSettings) return;
    if (!scope?.active || !scope.canPersistMutations || !hasFormShareDelta(scope.pendingRequest)) return;
    if (!scope.confirmed || !scope.desired) {
      retryBootstrap();
      return;
    }

    scope.mutationError = null;
    scope.desired = { ...scope.confirmed, ...scope.pendingOptimistic };
    notifyFormShareMutationScope(scope);
    void startMutationDrain(scope);
  }, [canUpdateSettings, retryBootstrap, startMutationDrain]);

  // A Form-to-Form switch can reuse this hook instance. Rotate the request
  // scope before paint/user events, without mutating refs during a potentially
  // abandoned concurrent render.
  useLayoutEffect(() => {
    if (formShareMutationPrincipalId !== principalId) {
      invalidateFormShareMutationScopes();
      formShareMutationPrincipalId = principalId;
    }

    // Scope discovery during render is intentionally side-effect free. Commit
    // one canonical lane here; if two providers rendered the same Form
    // concurrently, the later committer adopts the first lane on a synchronous
    // rerender before its passive bootstrap can run.
    const registered = formShareMutationScopes.get(mutationScope.key);

    if (
      registered &&
      registered !== mutationScope &&
      mutationScopeMatches(registered, principalId, workspaceId, databaseId, viewId)
    ) {
      setAdoptedMutationScope(registered);
      return;
    }

    const previous = mutationScopeRef.current;

    if (previous && previous !== mutationScope) {
      previous.owners.delete(mutationOwner);
      previous.ownerCanUpdateSettings.delete(mutationOwner);
      previous.subscribers.delete(mutationOwner);
      previous.active = previous.owners.size > 0;
      refreshMutationAuthority(previous);
      releaseFormShareMutationScope(previous);
    }

    formShareMutationScopes.set(mutationScope.key, mutationScope);
    mutationScope.owners.add(mutationOwner);
    mutationScope.ownerCanUpdateSettings.set(mutationOwner, canUpdateSettings);
    mutationScope.subscribers.set(mutationOwner, syncMutationScope);
    mutationScope.active = true;
    mutationScopeRef.current = mutationScope;
    refreshMutationAuthority(mutationScope);

    return () => {
      mutationScope.owners.delete(mutationOwner);
      mutationScope.ownerCanUpdateSettings.delete(mutationOwner);
      mutationScope.subscribers.delete(mutationOwner);
      mutationScope.active = mutationScope.owners.size > 0;
      if (mutationScopeRef.current === mutationScope) mutationScopeRef.current = null;
      refreshMutationAuthority(mutationScope);
      releaseFormShareMutationScope(mutationScope);
    };
  }, [canUpdateSettings, databaseId, mutationOwner, mutationScope, principalId, syncMutationScope, viewId, workspaceId]);

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
      setIsLoading(false);
      return;
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
    setIsLoading(true);
    void (async () => {
      // A previous mount may have handed this scope an in-flight outbox drain.
      // Let it settle before reading the token, otherwise a stale GET can race
      // and temporarily replace the just-persisted final choice.
      await scope.draining;
      if (cancelled || mutationScopeRef.current !== scope || !scope.active) return;

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
        const mutationRevisionAtRequest = scope.revision;
        const confirmedAtRequest = scope.confirmed;
        const outcome = await tryBootstrap(
          workspaceId,
          databaseId,
          viewId,
          () =>
            canUpdateSettings &&
            !cancelled &&
            mutationScopeRef.current === scope &&
            scope.active &&
            scope.canPersistMutations
        );

        if (cancelled || mutationScopeRef.current !== scope || !scope.active) return;
        if (outcome.kind === 'empty') {
          restoreMutationAuthorityAfterSuccessfulRead(scope, canUpdateSettings, mutationRevisionAtRequest);
          // A concurrent editable provider may have minted while this
          // read-only GET was in flight. Preserve that canonical token rather
          // than replacing it with the older empty observation.
          const shareChangedWhileReading =
            scope.revision !== mutationRevisionAtRequest || scope.confirmed !== confirmedAtRequest;

          if (shareChangedWhileReading && scope.confirmed) {
            setInfo(canUpdateSettings ? scope.desired : scope.confirmed);
            setError(null);
            setIsLoading(false);
            return;
          }

          scope.confirmed = null;
          scope.desired = null;
          notifyFormShareMutationScope(scope, true);
          setError(null);
          setIsLoading(false);
          return;
        }

        if (outcome.kind === 'success') {
          restoreMutationAuthorityAfterSuccessfulRead(scope, canUpdateSettings, mutationRevisionAtRequest);
          // Another provider for this Form may have mutated the canonical
          // outbox while this GET was in flight. Never let that older read
          // replace its optimistic/final state; the mutation drain broadcasts
          // the authoritative result to every committed subscriber.
          const shareChangedWhileReading =
            scope.revision !== mutationRevisionAtRequest || scope.confirmed !== confirmedAtRequest;

          if (shareChangedWhileReading && scope.confirmed) {
            setInfo(canUpdateSettings ? scope.desired : scope.confirmed);
            setError(canUpdateSettings ? scope.mutationError?.message ?? null : null);
            setIsLoading(false);
            return;
          }

          scope.confirmed = outcome.info;
          const hasPendingMutation = hasFormShareDelta(scope.pendingRequest);
          const canApplyPendingMutation = canUpdateSettings && hasPendingMutation;

          // A view-only mount must show the server-confirmed share settings,
          // never an unpersisted intent retained from an earlier editor. Keep
          // that outbox silent until an editable mount can legitimately drain
          // it.
          scope.desired = canApplyPendingMutation ? { ...outcome.info, ...scope.pendingOptimistic } : outcome.info;
          notifyFormShareMutationScope(scope, true);
          setError(canUpdateSettings ? scope.mutationError?.message ?? null : null);
          setIsLoading(false);
          if (canApplyPendingMutation) void startMutationDrain(scope);
          return;
        }

        lastError = outcome.error;

        if (!isViewPropagationError(outcome.error)) {
          // Non-transient error (auth, validation, 5xx, etc.) — break out so
          // we don't burn the user's time on a retry loop that cannot help.
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

      // eslint-disable-next-line no-console
      console.warn('[useFormShare] bootstrap failed after retries', lastError);
      setError(message);
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    bootstrapRevision,
    canUpdateSettings,
    databaseId,
    mutationScope,
    scopeKey,
    startMutationDrain,
    viewId,
    workspaceId,
  ]);

  const patch = useCallback(
    (requestDelta: FormShareDelta, optimisticDelta = requestDelta): Promise<void> => {
      const scope = mutationScopeRef.current;

      if (!canUpdateSettings) return Promise.resolve();
      if (!scope?.active || !scope.canPersistMutations || !scope.confirmed || !scope.desired) {
        return Promise.resolve();
      }

      // Apply invariant-derived values immediately for responsive UI, while
      // retaining only the fields the user actually changed for PATCH. Sparse
      // requests keep a desktop or another tab's unrelated concurrent setting.
      scope.pendingRequest = { ...scope.pendingRequest, ...requestDelta };
      scope.pendingOptimistic = { ...scope.pendingOptimistic, ...optimisticDelta };
      scope.desired = { ...scope.desired, ...scope.pendingOptimistic };
      scope.revision += 1;
      scope.mutationError = null;
      notifyFormShareMutationScope(scope);

      return startMutationDrain(scope);
    },
    [canUpdateSettings, startMutationDrain]
  );

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
  const scopedAuthorityDenied = stateMatchesScope ? authorityDenied : false;

  const resolveShareUrl = useCallback(() => {
    // Never guess from window.location or substitute a view ID. The server
    // deliberately owns this URL so separate Web/API origins and path-prefix
    // deployments stay correct; an invalid server snapshot must surface as
    // unavailable instead of becoming a copyable broken or unsafe link.
    return validatedShareUrl(scopedInfo);
  }, [scopedInfo]);

  // Memo the returned object so `FormShareProvider`'s context value has a
  // stable identity across renders that didn't actually change anything.
  // Without this, every parent re-render hands consumers a fresh object —
  // forcing `FormShareButton`, `FormAccessBanner`, and the popover subtree
  // to re-render even when info/setters are unchanged.
  return useMemo(
    () => ({
      canUpdateSettings: canUpdateSettings && !scopedAuthorityDenied,
      info: scopedInfo,
      isLoading: scopedIsLoading,
      error: scopedError,
      retryBootstrap,
      retryMutation,
      setTier,
      setAnonymous,
      setSubmissionAccess,
      resolveShareUrl,
    }),
    [
      canUpdateSettings,
      scopedAuthorityDenied,
      scopedInfo,
      scopedIsLoading,
      scopedError,
      retryBootstrap,
      retryMutation,
      setTier,
      setAnonymous,
      setSubmissionAccess,
      resolveShareUrl,
    ]
  );
}
