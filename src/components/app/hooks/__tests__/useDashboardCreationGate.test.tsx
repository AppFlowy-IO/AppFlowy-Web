import { renderHook } from '@testing-library/react';

import { useDashboardCreationGate } from '../useDashboardCreationGate';

const dashboardRequiresPro = 'Creating a Dashboard view requires a Pro workspace.';
const getSubscriptions = jest.fn();
const mockReasonCalls: { enabled?: boolean; workspaceId?: string; requiresProMessage?: string }[] = [];
let mockMobileContext = false;
let mockRequiresPro = false;
let mockCreationEnabled = true;

jest.mock('@/application/constants', () => ({
  ...jest.requireActual('@/application/constants'),
  get EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED() {
    return mockCreationEnabled;
  },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
jest.mock('@/components/_shared/hooks/useMobileContext', () => ({ useMobileContext: () => mockMobileContext }));
jest.mock('../useTimelineCreationDisabledReason', () => ({
  useTimelineCreationDisabledReason: (
    _getSubscriptions: unknown,
    options: { enabled?: boolean; workspaceId?: string; requiresProMessage?: string }
  ) => {
    mockReasonCalls.push(options);
    return mockRequiresPro ? options.requiresProMessage : undefined;
  },
}));

function renderGate(enabled?: boolean) {
  return renderHook(() => useDashboardCreationGate(getSubscriptions, { workspaceId: 'workspace-id', enabled })).result
    .current;
}

describe('useDashboardCreationGate', () => {
  beforeEach(() => {
    mockReasonCalls.length = 0;
    mockMobileContext = false;
    mockRequiresPro = false;
    mockCreationEnabled = true;
  });

  it('allows creation on a desktop page of a Pro workspace', () => {
    expect(renderGate()).toEqual({ available: true, disabledReason: undefined });
    expect(mockReasonCalls).toEqual([
      { workspaceId: 'workspace-id', enabled: true, requiresProMessage: dashboardRequiresPro },
    ]);
  });

  it('gives the Dashboard wording of the Pro policy as the reason', () => {
    mockRequiresPro = true;

    expect(renderGate()).toEqual({ available: true, disabledReason: dashboardRequiresPro });
  });

  it('defers the plan request until the menu is open', () => {
    renderGate(false);

    expect(mockReasonCalls).toEqual([
      { workspaceId: 'workspace-id', enabled: false, requiresProMessage: dashboardRequiresPro },
    ]);
  });

  it('is not available in a mobile context, and asks for no plan there', () => {
    mockMobileContext = true;

    expect(renderGate(true).available).toBe(false);
    expect(mockReasonCalls.every((call) => call.enabled === false)).toBe(true);
  });

  it('allows Dashboard creation without the experimental database-view flag', () => {
    mockCreationEnabled = false;

    expect(renderGate(true).available).toBe(true);
    expect(mockReasonCalls.every((call) => call.enabled === true)).toBe(true);
  });
});
