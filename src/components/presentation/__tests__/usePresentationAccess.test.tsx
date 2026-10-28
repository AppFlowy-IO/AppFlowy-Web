import { act, renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { Role } from '@/application/types';

import { getPresentationStatus } from '../presentation-client';
import type { PresentationStatus } from '../server-contract';
import { usePresentationAccess } from '../usePresentationAccess';

const mockWorkspace = { id: 'workspace', role: Role.Owner, owner: { uid: 'owner' } };
let mockWorkspaceId = 'workspace';

jest.mock('../presentation-client', () => ({
  getPresentationStatus: jest.fn(),
  entitlementForStatus: jest.requireActual('../server-adapter').entitlementForStatus,
}));
jest.mock('@/application/services/js-services/http', () => ({ getAxiosInstance: jest.fn() }));
jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => mockWorkspaceId,
  useUserWorkspaceInfo: () => ({ workspaces: [mockWorkspace] }),
}));
jest.mock('@/components/app/hooks/useServerInfo', () => ({ useIsOfficialHosted: () => true }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => ({ uid: 'owner' }) }));
jest.mock('sonner', () => ({ toast: { info: jest.fn() } }));

const status: PresentationStatus = {
  schemaVersion: 1,
  promptBundleVersion: 'bundle',
  plan: 'paid',
  usage: { freeSlides: 0, reservedSlides: 3, freeExports: 0, reservedExports: 1 },
  remainingSlides: 97,
  themes: [],
  slideSchemas: [1, 2],
  maxSlides: 100,
  aiResponses: { metered: true, accountingReady: true, committed: 49, reserved: 1, limit: 50, remaining: 0 },
};
const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter
    future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    initialEntries={['/app/workspace/page?keep=1']}
  >
    {children}
  </MemoryRouter>
);
beforeEach(() => {
  jest.mocked(getPresentationStatus).mockReset();
  mockWorkspaceId = 'workspace';
});

test('uses presentation reservations and opens the existing upgrade route after leaving fullscreen', async () => {
  jest.mocked(getPresentationStatus).mockResolvedValue(status);
  const { result } = renderHook(() => ({ access: usePresentationAccess(), location: useLocation() }), { wrapper });

  await waitFor(() => expect(result.current.access.isPro).toBe(true));
  expect(result.current.access.entitlement).toMatchObject({
    canGenerateMap: false,
    remainingSlides: 97,
    aiResponsesUsed: 49,
  });
  expect(getPresentationStatus).toHaveBeenCalledWith({ workspaceId: 'workspace' }, expect.any(AbortSignal));
  const exit = jest.fn(async () => undefined);

  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.body });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
  try {
    await act(() => result.current.access.onUpgrade());
    expect(exit).toHaveBeenCalledTimes(1);
    const query = new URLSearchParams(result.current.location.search);

    expect(query.get('action')).toBe('change_plan');
    expect(query.get('keep')).toBe('1');
  } finally {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  }
});

test('clears paid access after a failed refresh and treats unknown AI accounting as unavailable', async () => {
  jest
    .mocked(getPresentationStatus)
    .mockResolvedValue({ ...status, aiResponses: { accountingReady: false, retryable: true } });
  const { result } = renderHook(() => usePresentationAccess(), { wrapper });

  await waitFor(() => expect(result.current.isPro).toBe(true));
  expect(result.current.entitlement).toMatchObject({
    canGenerateMap: false,
    aiAccountingReady: false,
    aiResponsesUsed: null,
  });
  jest.mocked(getPresentationStatus).mockRejectedValue(new Error('Access revoked'));
  await act(async () => {
    await result.current.refresh().catch(() => undefined);
  });
  expect(result.current.isPro).toBe(false);
  expect(result.current.canManageStyles).toBe(true);
  expect(result.current.error).toBe('Access revoked');
});

test('aborts old workspace reads and ignores their late completion', async () => {
  let resolveOld!: (value: PresentationStatus) => void;
  jest
    .mocked(getPresentationStatus)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        })
    )
    .mockResolvedValue({ ...status, plan: 'free' });
  const { result, rerender } = renderHook(() => usePresentationAccess(), { wrapper });
  const signal = jest.mocked(getPresentationStatus).mock.calls[0][1];

  mockWorkspaceId = 'next-workspace';
  rerender();
  await waitFor(() => expect(result.current.status?.plan).toBe('free'));
  expect(signal?.aborted).toBe(true);
  await act(async () => resolveOld(status));
  expect(result.current.isPro).toBe(false);
});

test('does not invent paid style entitlement from status or block the owner before it arrives', async () => {
  let resolveStatus!: (value: PresentationStatus) => void;
  jest.mocked(getPresentationStatus).mockImplementation(() => new Promise((resolve) => { resolveStatus = resolve; }));
  const { result } = renderHook(() => usePresentationAccess(), { wrapper });

  expect(result.current.entitlement).toBeUndefined();
  expect(result.current.canManageStyles).toBe(true);
  await act(async () => resolveStatus({ ...status, plan: 'free', remainingSlides: 4, maxSlides: 9 }));
  expect(result.current.canManageStyles).toBe(true);
  expect(result.current.entitlement).toMatchObject({ remainingSlides: 4, maxSlides: 9 });
  expect(result.current.entitlement).not.toHaveProperty('canExport');
});
