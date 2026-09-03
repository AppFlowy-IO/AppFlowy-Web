import { lazy, Suspense, useEffect, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { getPublicFormSchema, type PublicFormAPIError } from '@/application/services/js-services/http/form-api';
import { beginPublicFormAuthentication } from '@/application/session/public_form_auth';
import { PublicFormResponse, PublicFormSchema } from '@/application/types/form';
import { ReactComponent as AppFlowyLogo } from '@/assets/icons/logo.svg';
import { FullScreenLoading } from '@/components/_shared/FullScreenLoading';
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
 *   - `auth_required`   — guide the respondent to log in or sign up
 *   - `closed`          — render server-supplied "no longer accepting" copy
 *   - `error`           — 404/410/network or transport failure.
 */
type Status =
  | { kind: 'loading' }
  | { kind: 'active'; schema: PublicFormSchema }
  | { kind: 'auth_required'; reason: 'signed_out' | 'not_a_workspace_member' }
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
            setStatus({ kind: 'auth_required', reason: 'signed_out' });
            break;
        }
      })
      .catch((err: Partial<PublicFormAPIError>) => {
        if (cancelled) return;

        if (err.publicCode === 'auth_required' || err.publicCode === 'not_a_workspace_member') {
          setStatus({
            kind: 'auth_required',
            reason: err.publicCode === 'not_a_workspace_member' ? 'not_a_workspace_member' : 'signed_out',
          });
          return;
        }

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
        <div
          data-testid='public-form-scroll-container'
          className='appflowy-scroller h-screen w-full overflow-y-auto overflow-x-hidden'
        >
          <ErrorBoundary
            fallback={
              <FormMessageLayout
                title='Couldn’t load this form'
                body='A form component could not be loaded. Refresh the page to try again.'
              />
            }
          >
            <Suspense fallback={<FormLoading />}>
              <FormBody token={token} schema={status.schema} />
            </Suspense>
          </ErrorBoundary>
        </div>
      );
    case 'auth_required':
      return <FormAuthenticationGate token={token} reason={status.reason} />;
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

function FormLoading() {
  return <FullScreenLoading label='Loading form' />;
}

function FormAuthenticationGate({ token, reason }: { token: string; reason: 'signed_out' | 'not_a_workspace_member' }) {
  const requiresAnotherAccount = reason === 'not_a_workspace_member';

  return (
    <div
      data-testid='public-form-auth-required'
      className='appflowy-scroller h-screen w-full overflow-y-auto bg-background-primary'
    >
      <div className='flex min-h-full items-center justify-center px-6 py-10'>
        <div className='flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border border-line-divider bg-surface-layer-01 px-8 py-10 text-center shadow-lg'>
          <div className='flex h-14 w-14 items-center justify-center rounded-xl bg-fill-content'>
            <AppFlowyLogo className='h-8 w-8' aria-hidden />
          </div>
          <div className='flex flex-col items-center gap-2'>
            <h1 className='text-2xl font-semibold'>
              {requiresAnotherAccount ? 'Use a workspace member account' : 'You’re almost there!'}
            </h1>
            <p className='max-w-sm text-text-caption'>
              {requiresAnotherAccount
                ? 'This account does not have access. Log in with a workspace member account to fill out this form.'
                : 'Log in with your workspace account to fill out this form.'}
            </p>
          </div>
          <div className='flex w-full flex-col gap-3'>
            <Button size='lg' className='w-full' onClick={() => beginPublicFormAuthentication(token, 'login')}>
              {requiresAnotherAccount ? 'Use another account' : 'Log in'}
            </Button>
            <Button
              size='lg'
              variant='outline'
              className='w-full'
              onClick={() => beginPublicFormAuthentication(token, 'signUp')}
            >
              Sign up
            </Button>
          </div>
          <p className='text-xs text-text-caption'>
            New accounts must be invited to this workspace before they can respond.
          </p>
        </div>
      </div>
    </div>
  );
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
