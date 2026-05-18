import { useEffect, useState } from 'react';

import { getPublicFormSchema } from '@/application/services/js-services/http';
import { PublicFormResponse, PublicFormSchema } from '@/application/types/form';
import NotFound from '@/components/error/NotFound';
import { Button } from '@/components/ui/button';

import { FormBody } from './FormBody';

/**
 * Container component for the public form page. Owns the fetch + branch
 * lifecycle and delegates rendering to a thin per-state widget — this
 * keeps the orchestration testable without coupling to the input
 * components.
 *
 * Five terminal states:
 *   - `loading`         — initial fetch
 *   - `active`          — render the form
 *   - `auth_required`   — render "Log in to fill out" CTA pointing at `login_url`
 *   - `closed`          — render server-supplied "no longer accepting" copy
 *   - `error`           — 404/410/network. We don't auto-retry; the page is
 *                          read-mostly and a stale tab being asked to retry
 *                          forever would mask a real outage.
 */
type Status =
  | { kind: 'loading' }
  | { kind: 'active'; schema: PublicFormSchema }
  | { kind: 'auth_required'; login_url: string }
  | { kind: 'closed'; message: string }
  | { kind: 'error'; code: number; message: string };

export function FormView({ token }: { token: string }) {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    setStatus({ kind: 'loading' });
    getPublicFormSchema(token)
      .then((res: PublicFormResponse) => {
        if (cancelled) return;
        switch (res.kind) {
          case 'active':
            setStatus({ kind: 'active', schema: res });
            break;
          case 'closed':
            setStatus({ kind: 'closed', message: res.message });
            break;
          case 'auth_required':
            setStatus({ kind: 'auth_required', login_url: res.login_url });
            break;
        }
      })
      .catch((err: { code?: number; message?: string }) => {
        if (cancelled) return;
        setStatus({
          kind: 'error',
          code: err.code ?? -1,
          message: err.message ?? 'Failed to load form',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  switch (status.kind) {
    case 'loading':
      return <FormLoading />;
    case 'active':
      return <FormBody token={token} schema={status.schema} />;
    case 'auth_required':
      return (
        <FormMessageLayout
          title='Log in to fill out this form'
          body='This form is only available to members of the workspace. Sign in to continue.'
          action={
            <Button
              onClick={() => {
                // The cloud-supplied `login_url` already round-trips back
                // to the form (it embeds `next=…` per
                // `build_login_url_for_form`). Hard navigate —
                // react-router would lose the cross-origin redirect.
                window.location.href = status.login_url;
              }}
            >
              Log in
            </Button>
          }
        />
      );
    case 'closed':
      return (
        <FormMessageLayout
          title='Form closed'
          body={status.message}
        />
      );
    case 'error':
      // 404 / 410 surface as a clean Not Found to avoid leaking server
      // internals; everything else gets a generic error layout.
      if (status.code === 404 || status.code === 410) {
        return <NotFound />;
      }

      return (
        <FormMessageLayout
          title='Couldn’t load this form'
          body={status.message}
        />
      );
  }
}

function FormLoading() {
  return (
    <div className='flex h-screen items-center justify-center text-text-caption'>
      Loading…
    </div>
  );
}

function FormMessageLayout({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className='flex h-screen flex-col items-center justify-center gap-3 px-6 text-center'>
      <h1 className='text-2xl font-semibold'>{title}</h1>
      <p className='max-w-md text-text-caption'>{body}</p>
      {action}
    </div>
  );
}
