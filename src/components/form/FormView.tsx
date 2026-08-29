import { lazy, Suspense, useEffect, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { getPublicFormSchema } from '@/application/services/js-services/http/form-api';
import { PublicFormResponse, PublicFormSchema } from '@/application/types/form';
import { Button } from '@/components/ui/button';

let formBodyModulePromise: Promise<typeof import('./FormBody')> | undefined;

export function preloadFormBodyModule() {
  formBodyModulePromise ??= import('./FormBody');
  return formBodyModulePromise;
}

const FormBody = lazy(() => preloadFormBodyModule().then(({ FormBody }) => ({ default: FormBody })));

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
 *   - `error`           — 404/410/network or transport failure.
 */
type Status =
  | { kind: 'loading' }
  | { kind: 'active'; schema: PublicFormSchema }
  | { kind: 'auth_required'; login_url: string }
  | { kind: 'closed'; message: string }
  | { kind: 'error'; code: number; message: string };

export function FormView({
  token,
  notFoundFallback,
}: {
  token: string;
  /** Rendered only when the public Form endpoint definitively returns 404. */
  notFoundFallback?: React.ReactNode;
}) {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    // Start the small respondent shell at the same time as the schema request.
    // The question-type preloader below keeps date/media/long-text controls
    // conditional on the returned schema.
    const bodyModule = preloadFormBodyModule();

    // Closed/auth-required responses do not await this module. Observe a
    // potential chunk error now so those branches cannot create an unhandled
    // rejection; active forms surface it through the schema chain below.
    void bodyModule.catch(() => undefined);

    setStatus({ kind: 'loading' });
    getPublicFormSchema(token)
      .then(async (res: PublicFormResponse) => {
        if (cancelled) return;
        switch (res.kind) {
          case 'active': {
            // Render the respondent shell immediately. Conditional controls
            // begin loading as soon as the body module is available, while
            // each question's Suspense boundary streams its own placeholder
            // instead of letting the slowest leaf chunk block the whole form.
            void bodyModule
              .then(({ preloadFormQuestionInputs }) => preloadFormQuestionInputs(res.questions))
              .catch(() => undefined);
            setStatus({ kind: 'active', schema: res });
            break;
          }

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
      return (
        <ErrorBoundary
          fallback={
            <FormMessageLayout
              title='Couldn’t load this form'
              body='A form component could not be loaded. Refresh the page to try again.'
            />
          }
        >
          <Suspense fallback={<FormLoading label='Loading form…' />}>
            <FormBody token={token} schema={status.schema} />
          </Suspense>
        </ErrorBoundary>
      );
    case 'auth_required':
      return (
        <FormMessageLayout
          testid='public-form-auth-required'
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
      return <FormMessageLayout testid='public-form-closed' title='Form closed' body={status.message} />;
    case 'error':
      // `/form/:value` is also a legacy publish namespace. A UUID-shaped
      // publish slug is indistinguishable from a Form token until the Form API
      // authoritatively returns 404, so only that response may hand rendering
      // back to the publish router. Revoked/expired (410), auth, closed, and
      // transient failures must remain Form outcomes.
      if (status.code === 404 && notFoundFallback !== undefined) {
        return <>{notFoundFallback}</>;
      }

      // 404 / 410 surface as a clean Not Found to avoid leaking server
      // internals when no route fallback was supplied.
      if (status.code === 404 || status.code === 410) {
        return (
          <FormMessageLayout
            testid='public-not-found'
            title='Form not found'
            body='This form does not exist or is no longer available.'
          />
        );
      }

      return <FormMessageLayout title='Couldn’t load this form' body={status.message} />;
  }
}

function FormLoading({ label = 'Loading…' }: { label?: string }) {
  return <div className='flex h-screen items-center justify-center text-text-caption'>{label}</div>;
}

function FormMessageLayout({
  title,
  body,
  action,
  testid,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
  testid?: string;
}) {
  return (
    <div data-testid={testid} className='flex h-screen flex-col items-center justify-center gap-3 px-6 text-center'>
      <h1 className='text-2xl font-semibold'>{title}</h1>
      <p className='max-w-md text-text-caption'>{body}</p>
      {action}
    </div>
  );
}
