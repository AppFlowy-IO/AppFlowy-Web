/**
 * MCP OAuth consent page (Phase H2 of the AppFlowy MCP rollout).
 *
 * Path: `/oauth/mcp/authorize`
 *
 * Flow:
 * 1. AppFlowy-Cloud's `GET /api/mcp/authorize` 302-redirects browsers
 *    here with all OAuth params on the query string. (Set
 *    `MCP_OAUTH_INLINE_FORM=false` on the backend to enable this path.)
 * 2. If the user isn't signed in to the web app, navigate to the existing
 *    `/login` page with a `redirectTo` back to here. Login flow (email,
 *    Google, magic link, SSO) is reused as-is.
 * 3. Once signed in, render a consent UI: pick a workspace + Allow / Deny.
 * 4. On Allow → POST `/api/mcp/authorize/code` with the user's existing
 *    AppFlowy JWT in `Authorization: Bearer …`. Backend mints the OAuth
 *    code and returns `{redirect_url}`. We `window.location.href = …` to
 *    send the browser back to Claude Code's local callback port.
 * 5. On Deny → navigate directly to `${redirect_uri}?error=access_denied&state=…`
 *    (per OAuth 2.1 §4.1.2.1).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { McpService } from '@/application/services/domains';
import { getMcpBaseUrl } from '@/application/services/js-services/http/mcp-api';
import { getWorkspaces } from '@/application/services/js-services/http/workspace-api';
import { getTokenParsed } from '@/application/session/token';
import { Role, Workspace } from '@/application/types';
import { ReactComponent as Logo } from '@/assets/icons/logo.svg';
import { useCurrentUserOptional, useIsAuthenticatedOptional } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';

interface OAuthParams {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  code_challenge: string;
  code_challenge_method: string;
  state?: string;
  scope?: string;
}

function readParams(search: URLSearchParams): OAuthParams | { error: string } {
  const required = [
    'client_id',
    'redirect_uri',
    'response_type',
    'code_challenge',
    'code_challenge_method',
  ] as const;

  for (const k of required) {
    if (!search.get(k)) return { error: `Missing required parameter: ${k}` };
  }

  return {
    client_id: search.get('client_id')!,
    redirect_uri: search.get('redirect_uri')!,
    response_type: search.get('response_type')!,
    code_challenge: search.get('code_challenge')!,
    code_challenge_method: search.get('code_challenge_method')!,
    state: search.get('state') ?? undefined,
    scope: search.get('scope') ?? undefined,
  };
}

function getJwt(): string | null {
  return getTokenParsed()?.access_token ?? null;
}

function isOwner(workspace: Workspace | undefined, userUid: string | undefined): boolean {
  if (!workspace || !userUid) return false;

  return workspace.role === Role.Owner || workspace.owner?.uid.toString() === userUid;
}

function MCPAuthorizePage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const isAuthenticated = useIsAuthenticatedOptional();
  const currentUser = useCurrentUserOptional();

  const parsed = useMemo(() => readParams(search), [search]);
  const params = 'error' in parsed ? null : parsed;
  const paramError = 'error' in parsed ? parsed.error : null;

  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [approvingClient, setApprovingClient] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [clientUri, setClientUri] = useState<string | null>(null);
  const [clientLogoUri, setClientLogoUri] = useState<string | null>(null);
  const [approvalNeeded, setApprovalNeeded] = useState(false);

  // 2. Not signed in → bounce through the existing login flow.
  useEffect(() => {
    if (paramError) return;
    if (isAuthenticated) return;
    const redirectTo = window.location.pathname + window.location.search;

    navigate(`/login?redirectTo=${encodeURIComponent(redirectTo)}`, { replace: true });
  }, [isAuthenticated, paramError, navigate]);

  // 2b. Resolve the client_id → friendly client_name so we don't show a
  // meaningless hex string. Public lookup, no auth required. We can do
  // this before login completes since it doesn't depend on the user.
  useEffect(() => {
    if (!params) return;
    const apiBase = getMcpBaseUrl();
    let cancelled = false;

    fetch(`${apiBase}/api/mcp/clients/${encodeURIComponent(params.client_id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        if (typeof j.client_name === 'string' && j.client_name.length > 0) {
          setClientName(j.client_name);
        }

        if (typeof j.client_uri === 'string' && j.client_uri.length > 0) {
          setClientUri(j.client_uri);
        }

        if (typeof j.logo_uri === 'string' && j.logo_uri.length > 0) {
          setClientLogoUri(j.logo_uri);
        }
      })
      .catch(() => {
        // Fall back to the truncated id below — not worth surfacing.
      });
    return () => {
      cancelled = true;
    };
  }, [params]);

  // 3. Once signed in, fetch the user's workspaces for the picker.
  useEffect(() => {
    if (!isAuthenticated || !params || workspaces !== null) return;
    let cancelled = false;

    getWorkspaces()
      .then((ws) => {
        if (cancelled) return;
        setWorkspaces(ws);
        setSelectedWorkspace(ws[0]?.id ?? '');
      })
      .catch((e) => {
        if (cancelled) return;
        setSubmitError(`Failed to load workspaces: ${e?.message ?? e}`);
        setWorkspaces([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, params, workspaces]);

  useEffect(() => {
    setApprovalNeeded(false);
    setSubmitError(null);
  }, [selectedWorkspace]);

  if (paramError) {
    return <ErrorPanel title='Invalid request' message={paramError} />;
  }

  if (!isAuthenticated) {
    return <Centered>Redirecting to sign in…</Centered>;
  }

  if (workspaces === null) {
    return <Centered>Loading…</Centered>;
  }

  if (workspaces.length === 0) {
    return (
      <ErrorPanel
        title='No workspace'
        message='Your account has no workspaces. Create one in AppFlowy first, then retry.'
      />
    );
  }

  const selectedWorkspaceInfo = workspaces.find((w) => w.id === selectedWorkspace);
  const canApproveSelectedWorkspace = isOwner(selectedWorkspaceInfo, currentUser?.uid);

  const createAuthorizationCode = async () => {
    if (!params) throw new Error('Invalid authorization request.');
    const token = getTokenParsed();
    const jwt = getJwt();

    if (!jwt) throw new Error('No access token available; please sign in again.');
    const apiBase = getMcpBaseUrl();
    const resp = await fetch(`${apiBase}/api/mcp/authorize/code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        client_id: params.client_id,
        redirect_uri: params.redirect_uri,
        code_challenge: params.code_challenge,
        code_challenge_method: params.code_challenge_method,
        workspace_id: selectedWorkspace,
        state: params.state,
        scope: params.scope,
        appflowy_refresh_token: token?.refresh_token,
        appflowy_expires_at: token?.expires_at,
      }),
    });
    const body = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      const error = new Error(body?.error_description ?? body?.error ?? `HTTP ${resp.status}`) as Error & {
        oauthError?: string;
      };

      error.oauthError = typeof body?.error === 'string' ? body.error : undefined;
      throw error;
    }

    if (typeof body?.redirect_url !== 'string') {
      throw new Error('Authorization server did not return a redirect URL.');
    }

    return body.redirect_url;
  };

  const onAllow = async () => {
    if (!params || submitting) return;
    setSubmitting(true);
    setApprovalNeeded(false);
    setSubmitError(null);
    try {
      const redirectUrl = await createAuthorizationCode();

      // Hand off to the LLM client's local callback. This is the last
      // thing we do — the user is leaving AppFlowy now.
      window.location.href = redirectUrl;
    } catch (e: unknown) {
      const err = e as Error & { oauthError?: string };
      const msg = e instanceof Error ? e.message : String(e);

      if (err.oauthError === 'invalid_client' && canApproveSelectedWorkspace) {
        setApprovalNeeded(true);
        setSubmitError(`${msg} Approve this client for the selected workspace to continue.`);
      } else if (err.oauthError === 'invalid_client') {
        setSubmitError(`${msg} Ask a workspace owner to approve this MCP client.`);
      } else {
        setSubmitError(msg);
      }

      setSubmitting(false);
    }
  };

  const onApproveAndAllow = async () => {
    if (!params || !selectedWorkspace || approvingClient) return;
    setApprovingClient(true);
    setSubmitError(null);
    try {
      await McpService.approveClient(selectedWorkspace, params.client_id);
      const redirectUrl = await createAuthorizationCode();

      window.location.href = redirectUrl;
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : String(e));
      setApprovingClient(false);
    }
  };

  const onDeny = () => {
    if (!params) return;
    // OAuth 2.1 §4.1.2.1 — error MUST be `access_denied` and flow back
    // to the client via redirect.
    try {
      const url = new URL(params.redirect_uri);

      url.searchParams.set('error', 'access_denied');
      url.searchParams.set('error_description', 'The user denied the authorization request');
      if (params.state) url.searchParams.set('state', params.state);
      window.location.href = url.toString();
    } catch {
      setSubmitError('redirect_uri is not a valid URL');
    }
  };

  const usePicker = workspaces.length > 1;

  return (
    <Shell>
      <div className='flex items-start gap-3'>
        {clientLogoUri ? (
          <img className='h-10 w-10 rounded-300 object-cover' src={clientLogoUri} alt='' />
        ) : (
          <div className='flex h-10 w-10 items-center justify-center rounded-300 bg-fill-content'>
            <Logo className='h-5 w-5' />
          </div>
        )}
        <div className='min-w-0 flex-1'>
          <h1 className='truncate text-2xl font-semibold text-text-primary'>
            Authorize{' '}
            {clientName ? (
              <span className='text-text-action'>{clientName}</span>
            ) : (
              <span className='font-mono text-text-secondary'>{params!.client_id.slice(0, 12)}…</span>
            )}
          </h1>
          {clientUri && (
            <a
              href={clientUri}
              rel='noreferrer'
              target='_blank'
              className='block truncate text-xs text-text-secondary hover:text-text-primary'
            >
              {clientUri}
            </a>
          )}
        </div>
      </div>
      <p className='text-sm leading-relaxed text-text-secondary'>
        Allow this app to access your AppFlowy workspace. It will be able to read pages,
        search content, and create / update / delete documents on your behalf.
      </p>
      <div className='rounded-300 border border-border-primary bg-fill-content px-3 py-2 text-xs text-text-secondary'>
        Scope: <span className='font-medium text-text-primary'>{params!.scope || 'workspace'}</span>
      </div>

      {usePicker ? (
        <fieldset className='flex flex-col gap-1 rounded-400 border border-border-primary bg-fill-content p-4'>
          <legend className='px-1 text-xs font-medium uppercase tracking-wide text-text-secondary'>
            Workspace
          </legend>
          {workspaces.map((w) => {
            const checked = selectedWorkspace === w.id;

            return (
              <label
                key={w.id}
                className={`flex cursor-pointer items-center gap-3 rounded-300 px-2 py-2 text-sm text-text-primary transition-colors hover:bg-fill-content-hover ${
                  checked ? 'bg-fill-content-hover' : ''
                }`}
              >
                <input
                  type='radio'
                  name='workspace'
                  value={w.id}
                  checked={checked}
                  onChange={() => setSelectedWorkspace(w.id)}
                  className='accent-fill-theme-thick'
                />
                <span className='truncate'>{w.name || w.id}</span>
              </label>
            );
          })}
        </fieldset>
      ) : (
        <div className='rounded-400 border border-border-primary bg-fill-content p-4 text-sm text-text-primary'>
          <div className='mb-1 text-xs font-medium uppercase tracking-wide text-text-secondary'>
            Workspace
          </div>
          <div className='truncate'>{workspaces[0].name || workspaces[0].id}</div>
        </div>
      )}

      <div className='text-xs text-text-secondary'>
        Redirect: <code className='break-all rounded bg-fill-content px-1 py-0.5 font-mono text-[11px]'>
          {params!.redirect_uri}
        </code>
      </div>

      {submitError && (
        <div className='rounded-300 border border-border-error-thick bg-fill-error-select px-3 py-2 text-sm text-text-error'>
          {submitError}
        </div>
      )}

      <div className='mt-2 flex gap-3'>
        <Button
          variant='outline'
          size='lg'
          className='flex-1'
          onClick={onDeny}
          disabled={submitting}
        >
          Deny
        </Button>
        <Button
          variant='default'
          size='lg'
          className='flex-1'
          onClick={onAllow}
          disabled={submitting || !selectedWorkspace}
        >
          {submitting ? 'Authorizing…' : 'Allow access'}
        </Button>
      </div>
      {approvalNeeded && canApproveSelectedWorkspace && (
        <Button
          variant='outline'
          size='lg'
          className='w-full'
          onClick={onApproveAndAllow}
          disabled={approvingClient}
        >
          {approvingClient ? 'Approving…' : 'Approve client and continue'}
        </Button>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex min-h-screen items-center justify-center bg-bg-body px-4 py-10 text-text-primary'>
      <div className='flex w-full max-w-md flex-col gap-5'>
        <div className='flex flex-col items-center gap-3 pb-2'>
          <Logo className='h-9 w-9' />
          <div className='text-xs tracking-widest text-text-secondary'>
            AppFlowy MCP
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Shell>
      <div className='py-12 text-center text-sm text-text-secondary'>{children}</div>
    </Shell>
  );
}

function ErrorPanel({ title, message }: { title: string; message: string }) {
  return (
    <Shell>
      <h1 className='text-2xl font-semibold text-text-primary'>{title}</h1>
      <div className='rounded-300 border border-border-error-thick bg-fill-error-select px-3 py-2 text-sm text-text-error'>
        {message}
      </div>
    </Shell>
  );
}

export default MCPAuthorizePage;
