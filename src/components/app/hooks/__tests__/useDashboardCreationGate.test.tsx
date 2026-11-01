import { renderHook } from '@testing-library/react';

import { useDashboardCreationGate } from '../useDashboardCreationGate';

let mockMobileContext = false;

jest.mock('@/components/_shared/hooks/useMobileContext', () => ({ useMobileContext: () => mockMobileContext }));

function renderGate() {
  return renderHook(() => useDashboardCreationGate()).result.current;
}

describe('useDashboardCreationGate', () => {
  beforeEach(() => {
    mockMobileContext = false;
  });

  it('offers Dashboard creation on a desktop page (the plan is checked like Timeline)', () => {
    expect(renderGate()).toEqual({ available: true });
  });

  it('is not available in a mobile context', () => {
    mockMobileContext = true;

    expect(renderGate()).toEqual({ available: false });
  });
});
