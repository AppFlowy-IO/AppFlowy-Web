import { fireEvent, render, screen } from '@testing-library/react';

import { getPublicFormSchema } from '@/application/services/js-services/http/form-api';
import { beginPublicFormAuthentication } from '@/application/session/public_form_auth';
import type { PublicFormResponse, PublicFormSchema } from '@/application/types/form';
import { preloadFormQuestionInputs } from '@/components/form/FormBody';
import { FormView } from '@/components/form/FormView';

jest.mock('@/application/services/js-services/http/form-api', () => ({
  getPublicFormSchema: jest.fn(),
}));

jest.mock('@/application/session/public_form_auth', () => ({
  beginPublicFormAuthentication: jest.fn(),
}));

jest.mock('@/components/form/FormBody', () => ({
  FormBody: ({ token }: { token: string }) => <div data-testid='public-form-body'>{token}</div>,
  preloadFormQuestionInputs: jest.fn().mockResolvedValue(undefined),
}));

const mockGetPublicFormSchema = getPublicFormSchema as jest.MockedFunction<typeof getPublicFormSchema>;
const mockBeginPublicFormAuthentication = beginPublicFormAuthentication as jest.MockedFunction<
  typeof beginPublicFormAuthentication
>;
const mockPreloadFormQuestionInputs = preloadFormQuestionInputs as jest.MockedFunction<typeof preloadFormQuestionInputs>;

const activeSchema: PublicFormSchema = {
  form_id: 'form-token',
  tier: 'public',
  anonymous: true,
  title: 'Public form',
  questions: [],
  submit_label: 'Submit',
  submit_color: 'primary',
  confirmation_title: 'Thanks',
  allow_another_response: false,
  hide_branding: false,
};

function renderWithFallback() {
  return render(<FormView token='form-token' notFoundFallback={<div data-testid='publish-fallback' />} />);
}

describe('FormView publish fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, '', '/form/form-token');
    mockPreloadFormQuestionInputs.mockResolvedValue(undefined);
  });

  it('shows the shared three-dot indicator while the form is loading', () => {
    mockGetPublicFormSchema.mockReturnValue(new Promise(() => undefined));

    renderWithFallback();

    expect(screen.getByRole('status', { name: 'Loading form' })).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('guides unauthenticated respondents to log in or sign up and remembers the form destination', async () => {
    mockGetPublicFormSchema.mockResolvedValue({ kind: 'auth_required', login_url: '/login' });

    renderWithFallback();

    expect(await screen.findByRole('heading', { name: 'You’re almost there!' })).toBeTruthy();
    expect(screen.getByText('Log in with your workspace account to fill out this form.')).toBeTruthy();
    expect(screen.queryByText('Workspace form')).toBeNull();

    const login = screen.getByRole('button', { name: 'Log in' });
    const signUp = screen.getByRole('button', { name: 'Sign up' });

    fireEvent.click(login);
    fireEvent.click(signUp);
    expect(mockBeginPublicFormAuthentication).toHaveBeenNthCalledWith(1, 'form-token', 'login');
    expect(mockBeginPublicFormAuthentication).toHaveBeenNthCalledWith(2, 'form-token', 'signUp');
  });

  it.each([
    {
      error: { code: 401, publicCode: 'auth_required', message: 'Log in to continue.' },
      heading: 'You’re almost there!',
      loginLabel: 'Log in',
    },
    {
      error: {
        code: 403,
        publicCode: 'not_a_workspace_member',
        message: 'This form is only available to workspace members.',
      },
      heading: 'Use a workspace member account',
      loginLabel: 'Use another account',
    },
  ])(
    'turns $error.publicCode schema failures into an actionable authentication gate',
    async ({ error, heading, loginLabel }) => {
      mockGetPublicFormSchema.mockRejectedValue(error);

      renderWithFallback();

      expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Couldn’t load this form' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: loginLabel }));
      expect(mockBeginPublicFormAuthentication).toHaveBeenCalledWith('form-token', 'login');
    }
  );

  it('renders the publish route only when the Form API definitively returns 404', async () => {
    mockGetPublicFormSchema.mockRejectedValue({ code: 404, message: 'Not found' });

    renderWithFallback();

    expect(await screen.findByTestId('publish-fallback')).toBeTruthy();
    expect(screen.queryByTestId('public-not-found')).toBeNull();
    expect(screen.queryByTestId('public-form-scroll-container')).toBeNull();
  });

  it('keeps a revoked or expired Form token in the Form not-found state', async () => {
    mockGetPublicFormSchema.mockRejectedValue({ code: 410, message: 'Gone' });

    renderWithFallback();

    expect(await screen.findByTestId('public-not-found')).toBeTruthy();
    expect(screen.queryByTestId('publish-fallback')).toBeNull();
  });

  it('keeps transient Form failures in the Form error state', async () => {
    mockGetPublicFormSchema.mockRejectedValue({ code: 503, message: 'Try again later' });

    renderWithFallback();

    expect(await screen.findByRole('heading', { name: 'Couldn’t load this form' })).toBeTruthy();
    expect(screen.queryByTestId('publish-fallback')).toBeNull();
  });

  it('shows the exact owner quota message when schema access is rate limited', async () => {
    const message = 'This form has reached its submission limit. Please try again later.';

    mockGetPublicFormSchema.mockRejectedValue({
      code: 429,
      publicCode: 'user_rate_limited',
      retryAfterSecs: 3600,
      message,
    });

    renderWithFallback();

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Couldn’t load this form' })).toBeTruthy();
    expect(screen.queryByTestId('publish-fallback')).toBeNull();
  });

  it('keeps unrelated forbidden failures in the Form error state', async () => {
    mockGetPublicFormSchema.mockRejectedValue({
      code: 403,
      publicCode: 'public_sharing_disabled_by_admin',
      message: 'Public form sharing was disabled by a workspace administrator.',
    });

    renderWithFallback();

    expect(await screen.findByRole('heading', { name: 'Couldn’t load this form' })).toBeTruthy();
    expect(screen.queryByTestId('public-form-auth-required')).toBeNull();
  });

  it.each<{
    response: PublicFormResponse;
    expectedTestId: string;
  }>([
    { response: { kind: 'active', ...activeSchema }, expectedTestId: 'public-form-body' },
    {
      response: { kind: 'auth_required', login_url: '/login' },
      expectedTestId: 'public-form-auth-required',
    },
    { response: { kind: 'closed', message: 'Responses are closed' }, expectedTestId: 'public-form-closed' },
  ])('does not fall back for a $response.kind Form response', async ({ response, expectedTestId }) => {
    mockGetPublicFormSchema.mockResolvedValue(response);

    renderWithFallback();

    expect(await screen.findByTestId(expectedTestId)).toBeTruthy();
    expect(screen.queryByTestId('publish-fallback')).toBeNull();

    if (response.kind === 'active') {
      expect(mockPreloadFormQuestionInputs).toHaveBeenCalledWith(response.questions);
    }
  });

  it('renders an active form without waiting for conditional input preloads', async () => {
    let resolvePreload: (() => void) | undefined;

    mockPreloadFormQuestionInputs.mockReturnValue(
      new Promise<void>((resolve) => {
        resolvePreload = resolve;
      })
    );
    mockGetPublicFormSchema.mockResolvedValue({ kind: 'active', ...activeSchema });

    renderWithFallback();

    expect(await screen.findByTestId('public-form-body')).toBeTruthy();
    expect(mockPreloadFormQuestionInputs).toHaveBeenCalledWith(activeSchema.questions);
    resolvePreload?.();
  });

  it('renders an active form inside a viewport-height vertical scroller', async () => {
    mockGetPublicFormSchema.mockResolvedValue({ kind: 'active', ...activeSchema });

    renderWithFallback();

    const body = await screen.findByTestId('public-form-body');
    const scroller = screen.getByTestId('public-form-scroll-container');

    expect(scroller.contains(body)).toBe(true);
    expect(scroller.classList.contains('h-screen')).toBe(true);
    expect(scroller.classList.contains('overflow-y-auto')).toBe(true);
    expect(scroller.classList.contains('overflow-x-hidden')).toBe(true);
  });
});
