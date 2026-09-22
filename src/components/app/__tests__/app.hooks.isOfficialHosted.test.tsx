import { renderHook } from '@testing-library/react';
import { ReactNode } from 'react';

import { useIsOfficialHosted } from '@/components/app/app.hooks';
import { AuthInternalContext, AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';

function withAuth(value: Partial<AuthInternalContextType>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthInternalContext.Provider value={{ isAuthenticated: true, onChangeWorkspace: async () => undefined, ...value }}>
        {children}
      </AuthInternalContext.Provider>
    );
  };
}

describe('useIsOfficialHosted', () => {
  it('is false outside the auth layer', () => {
    const { result } = renderHook(() => useIsOfficialHosted());

    expect(result.current).toBe(false);
  });

  it('is false until server-info confirms the official cloud', () => {
    expect(renderHook(() => useIsOfficialHosted(), { wrapper: withAuth({}) }).result.current).toBe(false);
    expect(renderHook(() => useIsOfficialHosted(), { wrapper: withAuth({ isOfficialHosted: false }) }).result.current).toBe(
      false
    );
  });

  it('is true when server-info reported self_hosted: false', () => {
    expect(renderHook(() => useIsOfficialHosted(), { wrapper: withAuth({ isOfficialHosted: true }) }).result.current).toBe(
      true
    );
  });
});
