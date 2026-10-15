import { act, renderHook, waitFor } from '@testing-library/react';

import { Subscription, SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { getConfigValue } from '@/utils/runtime-config';

import { useEditorSubscriptionPlan } from '../useEditorSubscriptionPlan';

let mockUserId: string | undefined = 'user-a';
let mockWorkspaceId = '';
let mockServerUrl = 'https://cloud.example.com';
let mockHostingMode = 'cloud';
const mockGetSubscriptions = jest.fn<Promise<Subscription[]>, []>();
let workspaceSequence = 0;

jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({ workspaceId: mockWorkspaceId, getSubscriptions: mockGetSubscriptions }),
}));
jest.mock('@/components/main/app.hooks', () => ({
  useAuthenticatedUserIdOptional: () => mockUserId,
}));
jest.mock('@/components/app/hooks/useServerInfo', () => ({
  useServerHostingMode: () => mockHostingMode,
  useServerInfoState: () => ({ status: 'available' }),
}));
jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: jest.fn((_key: string, fallback: string) => fallback),
}));

const proSubscription: Subscription = {
  currency: 'USD',
  plan: SubscriptionPlan.Pro,
  price_cents: 1000,
  recurring_interval: SubscriptionInterval.Month,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });

  return { promise, resolve };
}

describe('editor color subscription reads', () => {
  beforeEach(() => {
    mockUserId = 'user-a';
    mockWorkspaceId = `workspace-${++workspaceSequence}`;
    mockServerUrl = 'https://cloud.example.com';
    jest.mocked(getConfigValue).mockImplementation(() => mockServerUrl);
    mockHostingMode = 'cloud';
    mockGetSubscriptions.mockReset().mockResolvedValue([proSubscription]);
  });

  it('does not load closed menus and shares pending and completed reads between open menus', async () => {
    const request = deferred<Subscription[]>();

    mockGetSubscriptions.mockReturnValue(request.promise);
    const { result, rerender } = renderHook(({ open }) => [
      useEditorSubscriptionPlan(open),
      useEditorSubscriptionPlan(open),
      useEditorSubscriptionPlan(false),
      useEditorSubscriptionPlan(false),
    ], { initialProps: { open: false } });

    expect(mockGetSubscriptions).not.toHaveBeenCalled();
    rerender({ open: true });
    expect(mockGetSubscriptions).toHaveBeenCalledTimes(1);
    await act(async () => request.resolve([proSubscription]));
    expect(result.current.every(({ isPro }) => isPro)).toBe(true);
    rerender({ open: false });
    rerender({ open: true });
    expect(mockGetSubscriptions).toHaveBeenCalledTimes(1);
  });

  it('isolates a pending plan when the authenticated account changes', async () => {
    const oldAccount = deferred<Subscription[]>();
    const nextAccount = deferred<Subscription[]>();

    mockGetSubscriptions.mockReturnValueOnce(oldAccount.promise).mockReturnValueOnce(nextAccount.promise);
    const { result, rerender } = renderHook(() => useEditorSubscriptionPlan(true));

    mockUserId = 'user-b';
    rerender();
    expect(mockGetSubscriptions).toHaveBeenCalledTimes(2);
    await act(async () => oldAccount.resolve([proSubscription]));
    expect(result.current.activeSubscriptionPlan).toBeNull();
    await act(async () => nextAccount.resolve([]));
    expect(result.current.activeSubscriptionPlan).toBe(SubscriptionPlan.Free);
  });

  it('does not reuse a different workspace or backend plan and bypasses billing on self-hosted servers', async () => {
    const { result, rerender } = renderHook(() => useEditorSubscriptionPlan(true));

    await waitFor(() => expect(result.current.isPro).toBe(true));
    mockGetSubscriptions.mockResolvedValue([]);
    mockWorkspaceId += '-other';
    rerender();
    await waitFor(() => expect(result.current.activeSubscriptionPlan).toBe(SubscriptionPlan.Free));
    mockServerUrl = 'https://other.example.com';
    rerender();
    await waitFor(() => expect(mockGetSubscriptions).toHaveBeenCalledTimes(3));
    mockHostingMode = 'self-hosted';
    rerender();
    expect(result.current.isPro).toBe(true);
    expect(mockGetSubscriptions).toHaveBeenCalledTimes(3);
  });

  it('keeps an outage unknown and retries when the menu is reopened', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockGetSubscriptions.mockRejectedValueOnce(new Error('billing unavailable'));
    const { result, rerender } = renderHook(({ open }) => useEditorSubscriptionPlan(open), {
      initialProps: { open: true },
    });

    try {
      await waitFor(() => expect(result.current.hasError).toBe(true));
      expect(result.current.activeSubscriptionPlan).toBeNull();
      rerender({ open: false });
      rerender({ open: true });
      await waitFor(() => expect(result.current.isPro).toBe(true));
      expect(mockGetSubscriptions).toHaveBeenCalledTimes(2);
    } finally {
      error.mockRestore();
    }
  });
});
