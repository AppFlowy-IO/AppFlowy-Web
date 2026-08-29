import { render, screen } from '@testing-library/react';

import { getPublicFormSchema } from '@/application/services/js-services/http/form-api';
import type { PublicFormResponse, PublicFormSchema } from '@/application/types/form';
import { FormView } from '@/components/form/FormView';

jest.mock('@/application/services/js-services/http/form-api', () => ({
  getPublicFormSchema: jest.fn(),
}));

jest.mock('@/components/form/FormBody', () => ({
  FormBody: ({ token }: { token: string }) => <div data-testid='public-form-body'>{token}</div>,
}));

const mockGetPublicFormSchema = getPublicFormSchema as jest.MockedFunction<typeof getPublicFormSchema>;

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
  });

  it('renders the publish route only when the Form API definitively returns 404', async () => {
    mockGetPublicFormSchema.mockRejectedValue({ code: 404, message: 'Not found' });

    renderWithFallback();

    expect(await screen.findByTestId('publish-fallback')).toBeTruthy();
    expect(screen.queryByTestId('public-not-found')).toBeNull();
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

  it.each<{
    response: PublicFormResponse;
    expectedTestId: string;
  }>([
    { response: { kind: 'active', ...activeSchema }, expectedTestId: 'public-form-body' },
    {
      response: { kind: 'auth_required', login_url: '/login?next=%2Fform%2Fform-token' },
      expectedTestId: 'public-form-auth-required',
    },
    { response: { kind: 'closed', message: 'Responses are closed' }, expectedTestId: 'public-form-closed' },
  ])('does not fall back for a $response.kind Form response', async ({ response, expectedTestId }) => {
    mockGetPublicFormSchema.mockResolvedValue(response);

    renderWithFallback();

    expect(await screen.findByTestId(expectedTestId)).toBeTruthy();
    expect(screen.queryByTestId('publish-fallback')).toBeNull();
  });
});
