import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { AuthService } from '@/application/services/domains';
import { LOGIN_ACTION } from '@/components/login/const';
import { ForgotPassword } from '@/components/login/ForgotPassword';
import { toast } from 'sonner';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/application/services/domains', () => ({
  AuthService: {
    forgotPassword: jest.fn(),
  },
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
  },
}));

const mockForgotPassword = AuthService.forgotPassword as jest.MockedFunction<typeof AuthService.forgotPassword>;
const mockToastError = toast.error as jest.MockedFunction<typeof toast.error>;

function LocationProbe() {
  const location = useLocation();

  return <output data-testid='location-search'>{location.search}</output>;
}

function renderForgotPassword() {
  return render(
    <MemoryRouter
      initialEntries={['/login?action=resetPassword&redirectTo=%2Fapp']}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <ForgotPassword email='alice@example.com' redirectTo='/app' />
      <LocationProbe />
    </MemoryRouter>
  );
}

describe('ForgotPassword', () => {
  beforeEach(() => {
    mockForgotPassword.mockReset();
    mockToastError.mockReset();
  });

  it('waits for a successful recovery request before showing the check-email step', async () => {
    let resolveRequest: (() => void) | undefined;
    const request = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });

    mockForgotPassword.mockReturnValue(request);
    renderForgotPassword();

    const submit = screen.getByTestId<HTMLButtonElement>('forgot-password-submit-button');

    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(mockForgotPassword).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('location-search').textContent).toBe('?action=resetPassword&redirectTo=%2Fapp');
    expect(submit.disabled).toBe(true);

    await act(async () => {
      resolveRequest?.();
      await request;
    });

    await waitFor(() => {
      const params = new URLSearchParams(screen.getByTestId('location-search').textContent || '');

      expect(params.get('action')).toBe(LOGIN_ACTION.CHECK_EMAIL_RESET_PASSWORD);
      expect(params.get('email')).toBe('alice@example.com');
    });
  });

  it('stays on the recovery form and reports an error when the request fails', async () => {
    mockForgotPassword.mockRejectedValue(new Error('Network unavailable'));
    renderForgotPassword();

    fireEvent.click(screen.getByTestId('forgot-password-submit-button'));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Network unavailable');
    });

    const params = new URLSearchParams(screen.getByTestId('location-search').textContent || '');

    expect(params.get('action')).toBe(LOGIN_ACTION.RESET_PASSWORD);
    expect(screen.getByTestId('forgot-password-submit-button').getAttribute('aria-busy')).toBeNull();
  });
});
