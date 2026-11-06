import { useCallback, useEffect, useRef, useState } from 'react';

import type { McpScope } from '@/application/mcp/setup';
import { UserService } from '@/application/services/domains';
import {
  approveMcpClient,
  createMcpAccessRequest,
  createMcpAuthorizationCode,
  denyMcpAuthorization,
  getMcpClientInfo,
  getMcpMemberStatus,
  isMcpAbortError,
  isMcpApiError,
  type McpClientInfo,
  type McpMemberStatus,
} from '@/application/services/domains/mcp';
import { getTokenParsed } from '@/application/session/token';
import type { Workspace } from '@/application/types';
import { Log } from '@/utils/log';

import {
  classifyDenyFailure,
  initialConsentScopes,
  isFatalConsentReason,
  pickDefaultWorkspaceId,
  toConsentErrorReason,
  toggleConsentScope,
  type ConsentErrorReason,
  type McpConsentRequest,
} from './consentModel';

/** The client description and the user's workspaces, loaded once per request. */
export type ConsentLoadState =
  | { kind: 'loading' }
  /** `client` is set when the description loaded but the workspaces rule the request out. */
  | { kind: 'failed'; reason: ConsentErrorReason; client?: McpClientInfo }
  | { kind: 'ready'; client: McpClientInfo; workspaces: Workspace[] };

/** The member status of the selected workspace. */
type ConsentStatusState =
  | { kind: 'loading'; workspaceId: string }
  | { kind: 'failed'; workspaceId: string; reason: ConsentErrorReason }
  | { kind: 'ready'; workspaceId: string; status: McpMemberStatus };

export type ConsentAction = 'allow' | 'approve-and-allow' | 'request-approval' | 'deny';

export type ConsentOutcome =
  | { kind: 'done'; redirectUrl: string }
  /** The user cancelled; `redirectUrl` is the server-validated `access_denied` redirect. */
  | { kind: 'cancelled'; redirectUrl: string }
  | { kind: 'request-sent' };

/** A Cancel from an error view that failed, classified by `classifyDenyFailure`. */
interface CancelFailure {
  reason: ConsentErrorReason;
  kind: 'refused' | 'transient';
}

/** An error that replaces the consent view. */
export interface ConsentFailure {
  reason: ConsentErrorReason;
  /** The user can go back to the consent view (a Cancel that failed for a transient reason). */
  dismissible?: boolean;
  /** A Cancel from the consent view failed, so this error view does not offer it again. */
  fromDeny?: boolean;
}

/**
 * The reason behind a failure that is not an abort. The MCP client logs its
 * own failures; anything else (a Cloud call, a bug on this page) would end
 * up as a bare "generic", so it is logged here with its stack.
 */
function failureReason(error: unknown): ConsentErrorReason {
  if (!isMcpApiError(error)) Log.error('[MCP] Consent step failed', error);
  return toConsentErrorReason(error);
}

/**
 * State and actions of the consent page for one authorization request. The
 * caller renders it and handles `onLoginRequired` (the session ended).
 */
export function useMcpConsent(request: McpConsentRequest, onLoginRequired: () => void) {
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [load, setLoad] = useState<ConsentLoadState>({ kind: 'loading' });
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [statusAttempt, setStatusAttempt] = useState(0);
  const [statusState, setStatusState] = useState<ConsentStatusState>();
  const [scopes, setScopes] = useState<McpScope[]>(() => initialConsentScopes(request.scope));
  const [busy, setBusy] = useState<ConsentAction | null>(null);
  const [actionError, setActionError] = useState<ConsentErrorReason | null>(null);
  const [failure, setFailure] = useState<ConsentFailure | null>(null);
  const [outcome, setOutcome] = useState<ConsentOutcome | null>(null);
  // A failed Cancel from an error view: a refusal holds for the rest of the
  // flow (Cancel is not offered again), a transient failure until the next try.
  const [cancelFailure, setCancelFailure] = useState<CancelFailure | null>(null);
  // Refs guard against a second click landing before the disabled buttons render.
  const busyRef = useRef<ConsentAction | null>(null);
  const actionControllerRef = useRef<AbortController | null>(null);
  const navigatedRef = useRef(false);
  const onLoginRequiredRef = useRef(onLoginRequired);

  useEffect(() => {
    onLoginRequiredRef.current = onLoginRequired;
  }, [onLoginRequired]);

  useEffect(() => () => actionControllerRef.current?.abort(), []);

  const handleSessionExpired = useCallback(() => {
    // A rejected refresh already ended the session, so signing in again helps.
    // A session the MCP service refuses while it is still valid here would
    // bounce between this page and the login page; end the flow instead.
    if (getTokenParsed()) setFailure({ reason: 'invalid_session' });
    else onLoginRequiredRef.current();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    setLoad({ kind: 'loading' });
    Promise.all([
      getMcpClientInfo(request.clientId, { signal: controller.signal }),
      UserService.getWorkspaceInfo(),
    ]).then(
      ([client, info]) => {
        if (controller.signal.aborted) return;

        const workspaces = info.workspaces ?? [];

        if (workspaces.length === 0) {
          setLoad({ kind: 'failed', reason: 'no_workspace', client });
          return;
        }

        const defaultWorkspaceId = pickDefaultWorkspaceId(workspaces, {
          requested: request.workspaceId,
          current: info.selectedWorkspace?.id,
        });

        if (!defaultWorkspaceId) {
          setLoad({ kind: 'failed', reason: 'guest_not_allowed', client });
          return;
        }

        setWorkspaceId(defaultWorkspaceId);
        setLoad({ kind: 'ready', client, workspaces });
      },
      (error: unknown) => {
        if (controller.signal.aborted || isMcpAbortError(error)) return;

        const reason = failureReason(error);

        if (reason === 'invalid_session') handleSessionExpired();
        else setLoad({ kind: 'failed', reason });
      }
    );

    return () => controller.abort();
  }, [handleSessionExpired, loadAttempt, request.clientId, request.workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;

    const controller = new AbortController();

    setStatusState({ kind: 'loading', workspaceId });
    getMcpMemberStatus(workspaceId, request.clientId, { signal: controller.signal }).then(
      (status) => {
        if (!controller.signal.aborted) setStatusState({ kind: 'ready', workspaceId, status });
      },
      (error: unknown) => {
        if (controller.signal.aborted || isMcpAbortError(error)) return;

        const reason = failureReason(error);

        if (reason === 'invalid_session') handleSessionExpired();
        else if (isFatalConsentReason(reason)) setFailure({ reason });
        else setStatusState({ kind: 'failed', workspaceId, reason });
      }
    );

    return () => controller.abort();
  }, [handleSessionExpired, request.clientId, statusAttempt, workspaceId]);

  // Render the done or cancelled view first, then leave: a private-use scheme
  // (cursor://) opens the app and keeps this tab, which then explains what happened.
  useEffect(() => {
    if (!outcome || outcome.kind === 'request-sent' || navigatedRef.current) return;

    navigatedRef.current = true;
    window.location.assign(outcome.redirectUrl);
  }, [outcome]);

  const reloadStatus = useCallback(() => setStatusAttempt((attempt) => attempt + 1), []);

  // A transient Cancel failure's note belongs to the error view it was shown on.
  const clearTransientCancelFailure = useCallback(
    () => setCancelFailure((current) => (current?.kind === 'refused' ? current : null)),
    []
  );

  const handleActionError = useCallback(
    (action: ConsentAction, reason: ConsentErrorReason) => {
      if (action === 'deny') {
        // Never fall back to the raw redirect_uri: only the server can vouch for it.
        setFailure({ reason, dismissible: classifyDenyFailure(reason) === 'transient', fromDeny: true });
        return;
      }

      switch (reason) {
        case 'invalid_session':
          handleSessionExpired();
          return;
        case 'client_not_approved':
        case 'already_approved':
          // Approval changed since the status loaded; show what applies now.
          reloadStatus();
          return;
        case 'not_workspace_owner':
          reloadStatus();
          setActionError(reason);
          return;
        default:
          if (isFatalConsentReason(reason)) setFailure({ reason });
          else setActionError(reason);
      }
    },
    [handleSessionExpired, reloadStatus]
  );

  /** Runs one action at a time; a task that ends the flow sets the outcome, whose view replaces the buttons. */
  const run = useCallback(
    async (action: ConsentAction, task: (signal: AbortSignal) => Promise<void>) => {
      if (busyRef.current) return;

      const controller = new AbortController();

      busyRef.current = action;
      actionControllerRef.current = controller;
      setBusy(action);
      setActionError(null);
      clearTransientCancelFailure();

      try {
        await task(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted && !isMcpAbortError(error)) {
          handleActionError(action, failureReason(error));
        }
      } finally {
        busyRef.current = null;
        setBusy(null);
      }
    },
    [clearTransientCancelFailure, handleActionError]
  );

  const authorize = useCallback(
    async (targetWorkspaceId: string, signal: AbortSignal) => {
      // No refresh token or expiry: the MCP service never shares the browser's GoTrue session.
      const { redirect_url } = await createMcpAuthorizationCode(
        {
          client_id: request.clientId,
          redirect_uri: request.redirectUri,
          code_challenge: request.codeChallenge,
          code_challenge_method: request.codeChallengeMethod,
          workspace_id: targetWorkspaceId,
          state: request.state,
          scope: scopes.join(' '),
          resource: request.resource,
        },
        { signal }
      );

      setOutcome({ kind: 'done', redirectUrl: redirect_url });
    },
    [request, scopes]
  );

  const allow = useCallback(() => {
    if (!workspaceId) return;
    void run('allow', (signal) => authorize(workspaceId, signal));
  }, [authorize, run, workspaceId]);

  const approveAndAllow = useCallback(() => {
    if (!workspaceId) return;
    void run('approve-and-allow', async (signal) => {
      await approveMcpClient(workspaceId, request.clientId, { signal });
      // If the code request fails now, the retry is a plain Allow.
      setStatusState((current) =>
        current?.kind === 'ready' && current.workspaceId === workspaceId && current.status.client
          ? {
              ...current,
              status: {
                ...current.status,
                client: { ...current.status.client, approved: true, request_pending: false },
              },
            }
          : current
      );
      await authorize(workspaceId, signal);
    });
  }, [authorize, request.clientId, run, workspaceId]);

  const requestApproval = useCallback(() => {
    if (!workspaceId) return;
    void run('request-approval', async (signal) => {
      await createMcpAccessRequest(workspaceId, request.clientId, { signal });
      setOutcome({ kind: 'request-sent' });
    });
  }, [request.clientId, run, workspaceId]);

  const requestDeny = useCallback(
    (signal: AbortSignal) =>
      denyMcpAuthorization(
        { client_id: request.clientId, redirect_uri: request.redirectUri, state: request.state },
        { signal }
      ),
    [request.clientId, request.redirectUri, request.state]
  );

  const deny = useCallback(() => {
    void run('deny', async (signal) => {
      const { redirect_url } = await requestDeny(signal);

      setOutcome({ kind: 'cancelled', redirectUrl: redirect_url });
    });
  }, [requestDeny, run]);

  /**
   * Cancel from an error view, so the app stops waiting. If the server refuses
   * the deny, the error view keeps its message and loses the button; if the
   * deny fails for a transient reason, the button stays with a note.
   */
  const cancelFromError = useCallback(() => {
    void run('deny', async (signal) => {
      const result = await requestDeny(signal).catch((error: unknown) => {
        if (signal.aborted || isMcpAbortError(error)) throw error;

        const reason = failureReason(error);

        setCancelFailure({ reason, kind: classifyDenyFailure(reason) });
        return null;
      });

      if (result) setOutcome({ kind: 'cancelled', redirectUrl: result.redirect_url });
    });
  }, [requestDeny, run]);

  const selectWorkspace = useCallback((id: string) => {
    if (busyRef.current) return;
    setActionError(null);
    setWorkspaceId(id);
  }, []);

  const toggleScope = useCallback((scope: McpScope, checked: boolean) => {
    setScopes((current) => toggleConsentScope(current, scope, checked));
  }, []);

  const reload = useCallback(() => {
    setFailure(null);
    clearTransientCancelFailure();
    setLoadAttempt((attempt) => attempt + 1);
  }, [clearTransientCancelFailure]);

  const dismissFailure = useCallback(() => {
    setFailure(null);
    clearTransientCancelFailure();
  }, [clearTransientCancelFailure]);

  const current = statusState?.workspaceId === workspaceId ? statusState : undefined;

  return {
    load,
    reload,
    workspaceId,
    selectWorkspace,
    /** The selected workspace's status once loaded. */
    status: current?.kind === 'ready' ? current.status : undefined,
    statusError: current?.kind === 'failed' ? current.reason : null,
    statusLoading: Boolean(workspaceId) && (!current || current.kind === 'loading'),
    reloadStatus,
    scopes,
    toggleScope,
    busy,
    actionError,
    failure,
    dismissFailure,
    outcome,
    allow,
    approveAndAllow,
    requestApproval,
    deny,
    /** Error views may offer Cancel until the server refuses one. */
    canCancelFromError: cancelFailure?.kind !== 'refused',
    /** Why the last Cancel from an error view failed for a transient reason; the button stays. */
    cancelError: cancelFailure?.kind === 'transient' ? cancelFailure.reason : null,
    cancelFromError,
  };
}
