import { act, fireEvent, render, screen } from '@testing-library/react';

import { AuthService } from '@/application/services/domains';
import { LOGIN_ACTION } from '@/components/login/const';
import CheckEmailResetPassword from '@/components/login/CheckEmailResetPassword';

jest.mock('react-i18next', () => ({
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/application/services/domains', () => ({
  AuthService: {
    signInOTP: jest.fn(),
  },
}));

const mockSignInOTP = AuthService.signInOTP as jest.MockedFunction<typeof AuthService.signInOTP>;

describe('CheckEmailResetPassword', () => {
  beforeEach(() => {
    mockSignInOTP.mockReset();
  });

  it('submits once and preserves the nested redirect as one serialized login URL', async () => {
    let resolveRequest: (() => void) | undefined;
    const request = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });

    mockSignInOTP.mockReturnValue(request);
    render(<CheckEmailResetPassword email='alice+recovery@example.com' redirectTo='/app?tab=a&filter=b' />);

    fireEvent.click(screen.getByRole('button', { name: 'enterCodeManually' }));
    fireEvent.change(screen.getByPlaceholderText('resetPassword.enterCode'), { target: { value: '123456' } });

    const submit = screen.getByRole('button', { name: 'resetPassword.continue' });

    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(mockSignInOTP).toHaveBeenCalledTimes(1);

    const call = mockSignInOTP.mock.calls[0][0];
    const continuation = new URL(call.redirectTo);

    expect(continuation.pathname).toBe('/login');
    expect(continuation.searchParams.get('action')).toBe(LOGIN_ACTION.CHANGE_PASSWORD);
    expect(continuation.searchParams.get('email')).toBe('alice+recovery@example.com');
    expect(continuation.searchParams.get('redirectTo')).toBe('/app?tab=a&filter=b');

    await act(async () => {
      resolveRequest?.();
      await request;
    });
  });
});
