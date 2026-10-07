import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { toast } from 'sonner';

import { APP_EVENTS } from '@/application/constants';
import { getSubscriptionLink } from '@/application/services/domains/billing';
import { getDatabaseViewCreationStatus } from '@/application/services/js-services/http/workspace-api';
import { Role, Subscription, SubscriptionInterval, SubscriptionPlan, ViewLayout, Workspace } from '@/application/types';
import { AppEventEmitter, AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { AFConfigContext } from '@/components/main/app.hooks';
import { ServerHostingMode } from '@/utils/server-info';

import { useDatabaseViewCreation } from '../useDatabaseViewCreation';

let mockHosting: ServerHostingMode = 'cloud';
let workspaceId: string;
let userId: string;
let role: Role;
let emitter: AppEventEmitter;
let workspaceSequence = 0;
let currentSearch = '';

function LocationRecorder() {
  currentSearch = useLocation().search;
  return null;
}

const subscriptions = jest.fn<Promise<Subscription[]>, []>();
const quota = jest.mocked(getDatabaseViewCreationStatus);
const checkout = jest.mocked(getSubscriptionLink);

jest.mock('@/application/services/js-services/http/workspace-api', () => ({ getDatabaseViewCreationStatus: jest.fn() }));
jest.mock('@/application/services/domains/billing', () => ({ getSubscriptionLink: jest.fn() }));
jest.mock('@/components/app/hooks/useServerInfo', () => ({ useServerHostingMode: () => mockHosting }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { error: jest.fn() }) }));

function Wrapper({ children }: { children: ReactNode }) {
  const workspace = { id: workspaceId, role } as Workspace;

  return (
    <MemoryRouter>
      <LocationRecorder />
    <AFConfigContext.Provider
      value={{
        isAuthenticated: true,
        authenticatedUserId: userId,
        updateCurrentUser: jest.fn(),
        openLoginModal: jest.fn(),
      }}
    >
      <AuthInternalContext.Provider
        value={{
          isAuthenticated: true,
          currentWorkspaceId: workspaceId,
          onChangeWorkspace: jest.fn(),
          userWorkspaceInfo: { userId, selectedWorkspace: workspace, workspaces: [workspace] },
        }}
      >
        <AppEventEmitterContext.Provider value={emitter}>{children}</AppEventEmitterContext.Provider>
      </AuthInternalContext.Provider>
    </AFConfigContext.Provider>
    </MemoryRouter>
  );
}

function mount(enabled = true) {
  return renderHook(
    ({ open }) => useDatabaseViewCreation({ workspaceId, getSubscriptions: subscriptions, enabled: open }),
    {
      initialProps: { open: enabled },
      wrapper: Wrapper,
    }
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { resolve, promise };
}

const subscription = (plan: SubscriptionPlan): Subscription => ({
  plan,
  currency: 'USD',
  price_cents: 1000,
  recurring_interval: SubscriptionInterval.Year,
});
const allowed = { can_create_form: true, can_create_chart: true };

describe('workspace database view creation', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    workspaceId = `workspace-${++workspaceSequence}`;
    userId = 'user';
    role = Role.Owner;
    mockHosting = 'cloud';
    emitter = new EventEmitter();
    emitter.webSocketReadyState = 1;
    quota.mockResolvedValue(allowed);
    subscriptions.mockResolvedValue([]);
    checkout.mockResolvedValue('https://checkout.example/pro');
    jest.spyOn(window, 'open').mockReturnValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each([SubscriptionPlan.Free, SubscriptionPlan.Team, SubscriptionPlan.Pro, SubscriptionPlan.AIMax])(
    'requires Pro or Team for Timeline in all environments (%s)',
    async (plan) => {
      subscriptions.mockResolvedValue([subscription(plan)]);
      const { result } = mount();

      expect(result.current.getAction(ViewLayout.Timeline)).toMatchObject({ type: 'disabled' });
      await waitFor(() =>
        expect(result.current.getAction(ViewLayout.Timeline).type).toBe(
          plan === SubscriptionPlan.Pro || plan === SubscriptionPlan.Team ? 'create' : 'upgrade'
        )
      );
    }
  );

  it('uses independent authoritative quotas even when the cached plan is Pro', async () => {
    subscriptions.mockResolvedValue([subscription(SubscriptionPlan.Pro)]);
    quota.mockResolvedValue({ can_create_form: true, can_create_chart: false });
    const { result } = mount();

    await waitFor(() => expect(result.current.getAction(ViewLayout.Form).type).toBe('create'));
    expect(result.current.getAction(ViewLayout.Chart)).toMatchObject({ type: 'upgrade', requiresPro: true });
    expect(result.current.getAction(ViewLayout.Timeline).type).toBe('create');
  });

  it.each([Role.Member, Role.Guest])('never offers billing to a %s after an allowance is used', async (memberRole) => {
    role = memberRole;
    quota.mockResolvedValue({ can_create_form: true, can_create_chart: false });
    const { result } = mount();

    await waitFor(() => expect(result.current.getAction(ViewLayout.Chart).reason).toBe('databaseViewCreation.askOwner'));
    expect(result.current.getAction(ViewLayout.Chart)).toMatchObject({
      type: 'disabled',
      reason: 'databaseViewCreation.askOwner',
      requiresPro: false,
    });
    expect(result.current.checkCreation(ViewLayout.Chart)).toBe(false);
    expect(result.current.checkCreation(ViewLayout.Timeline)).toBe(false);
    expect(result.current.checkCreation(ViewLayout.Form)).toBe(true);
    expect(checkout).not.toHaveBeenCalled();
  });

  it('closes the menu and opens plan selection before creating a checkout', async () => {
    const close = jest.fn();
    const { result } = mount();

    await waitFor(() => expect(result.current.getAction(ViewLayout.Timeline).type).toBe('upgrade'));
    act(() => {
      expect(result.current.checkCreation(ViewLayout.Timeline, close)).toBe(false);
      expect(result.current.checkCreation(ViewLayout.Timeline, close)).toBe(false);
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(currentSearch).toBe('?action=change_plan');
    expect(checkout).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('opens plan selection only for an upgrade action', async () => {
    quota.mockResolvedValue({ can_create_form: true, can_create_chart: false });
    const { result } = mount();

    await waitFor(() => expect(result.current.getAction(ViewLayout.Chart).type).toBe('upgrade'));
    expect(result.current.startCheckout(ViewLayout.Form)).toBeUndefined();
    expect(result.current.startCheckout(ViewLayout.Grid)).toBeUndefined();
    expect(currentSearch).toBe('');
    let opening: Promise<void> | undefined;

    act(() => {
      opening = result.current.startCheckout(ViewLayout.Chart);
      expect(result.current.startCheckout(ViewLayout.Timeline)).toBe(opening);
    });
    await act(async () => { await opening; });
    expect(currentSearch).toBe('?action=change_plan');
    expect(checkout).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('keeps quota and billing failures unavailable instead of showing a crown, and retries a blocked attempt', async () => {
    quota.mockRejectedValueOnce(new Error('Old server'));
    subscriptions.mockRejectedValueOnce(new Error('Billing unavailable'));
    const { result, rerender } = mount();

    await waitFor(() =>
      expect(result.current.getAction(ViewLayout.Chart).reason).toBe('databaseViewCreation.unavailable')
    );
    expect(result.current.getAction(ViewLayout.Chart).requiresPro).toBeUndefined();
    expect(result.current.getAction(ViewLayout.Timeline).requiresPro).toBeUndefined();
    expect(result.current.checkCreation(ViewLayout.Chart)).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('databaseViewCreation.unavailable');
    // Desktop parity: a blocked attempt refetches, so trying again can succeed.
    await waitFor(() => expect(result.current.getAction(ViewLayout.Chart).type).toBe('create'));
    expect(quota).toHaveBeenCalledTimes(2);
    rerender({ open: false });
    rerender({ open: true });
    await waitFor(() => expect(quota).toHaveBeenCalledTimes(3));
  });

  it('can use a free Form allowance even if billing fails', async () => {
    subscriptions.mockRejectedValue(new Error('Billing unavailable'));
    const { result } = mount();

    await waitFor(() => expect(result.current.getAction(ViewLayout.Form).type).toBe('create'));
    expect(result.current.getAction(ViewLayout.Timeline)).toMatchObject({
      type: 'disabled',
      reason: 'databaseViewCreation.unavailable',
    });
  });

  it.each(['unknown', 'self-hosted'] as const)('does not request quotas or billing on %s hosting', (hosting) => {
    mockHosting = hosting;
    emitter.webSocketReadyState = 3;
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { result } = mount();

    for (const layout of [ViewLayout.Form, ViewLayout.Chart, ViewLayout.Timeline]) {
      expect(result.current.getAction(layout).type).toBe(hosting === 'self-hosted' ? 'create' : 'disabled');
      expect(result.current.getAction(layout).requiresPro).toBeUndefined();
    }

    expect(quota).not.toHaveBeenCalled();
    expect(subscriptions).not.toHaveBeenCalled();
  });

  it('discards a previous workspace response immediately, including when returning to it', async () => {
    const originalWorkspaceId = workspaceId;
    const first = deferred<typeof allowed>();

    quota.mockReturnValueOnce(first.promise);
    const { result, rerender } = mount();

    workspaceId = 'second';
    quota.mockResolvedValue({ can_create_form: false, can_create_chart: false });
    rerender({ open: true });
    expect(result.current.getAction(ViewLayout.Form).type).toBe('disabled');
    await waitFor(() => expect(result.current.getAction(ViewLayout.Form).type).toBe('upgrade'));
    await act(async () => {
      first.resolve(allowed);
    });
    expect(result.current.getAction(ViewLayout.Form).type).toBe('upgrade');
    workspaceId = originalWorkspaceId;
    rerender({ open: true });
    expect(result.current.getAction(ViewLayout.Form).type).toBe('disabled');
    await waitFor(() => expect(result.current.getAction(ViewLayout.Form).type).toBe('upgrade'));
  });

  it('does not reuse quota results after the signed-in account changes', async () => {
    const { result, rerender } = mount();

    await waitFor(() => expect(result.current.getAction(ViewLayout.Form).type).toBe('create'));
    userId = 'another-user';
    quota.mockResolvedValue({ can_create_form: false, can_create_chart: false });
    rerender({ open: true });
    expect(result.current.getAction(ViewLayout.Form).type).toBe('disabled');
    await waitFor(() => expect(result.current.getAction(ViewLayout.Form).type).toBe('upgrade'));
    expect(quota).toHaveBeenCalledTimes(2);
  });

  it('revokes access on disconnect and fetches again after reconnect', async () => {
    const { result } = mount();

    await waitFor(() => expect(result.current.getAction(ViewLayout.Chart).type).toBe('create'));
    act(() => {
      emitter.webSocketReadyState = 3;
      emitter.emit(APP_EVENTS.WEBSOCKET_STATUS);
    });
    expect(result.current.getAction(ViewLayout.Chart)).toMatchObject({
      type: 'disabled',
      reason: 'databaseViewCreation.connectionRequired',
    });
    expect(result.current.checkCreation(ViewLayout.Chart)).toBe(false);
    act(() => {
      emitter.webSocketReadyState = 1;
      emitter.emit(APP_EVENTS.WEBSOCKET_STATUS);
    });
    await waitFor(() => expect(quota).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.getAction(ViewLayout.Chart).type).toBe('create'));
  });

  it('coalesces real folder changes while a request is pending and ignores the stale response', async () => {
    const pending = deferred<typeof allowed>();
    const next = deferred<typeof allowed>();

    quota.mockReturnValueOnce(pending.promise).mockReturnValueOnce(next.promise);
    const { result } = mount();

    act(() => {
      emitter.emit(APP_EVENTS.FOLDER_OUTLINE_CHANGED);
      emitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED);
      emitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED);
    });
    expect(quota).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(allowed);
    });
    expect(result.current.getAction(ViewLayout.Chart).type).toBe('disabled');
    expect(quota).toHaveBeenCalledTimes(2);
    await act(async () => {
      next.resolve({ can_create_form: true, can_create_chart: false });
    });
    expect(result.current.getAction(ViewLayout.Chart).type).toBe('upgrade');
  });

  it('does not poll or let idle socket notifications starve a slow request; closed menus stop refreshing', async () => {
    jest.useFakeTimers();
    const pending = deferred<typeof allowed>();

    quota.mockReturnValue(pending.promise);
    const { result, rerender } = mount(false);

    expect(quota).not.toHaveBeenCalled();
    rerender({ open: true });
    act(() => {
      jest.advanceTimersByTime(30_000);
      emitter.emit(APP_EVENTS.WEBSOCKET_STATUS);
    });
    await act(async () => {
      pending.resolve(allowed);
    });
    expect(result.current.getAction(ViewLayout.Chart).type).toBe('create');
    expect(quota).toHaveBeenCalledTimes(1);
    rerender({ open: false });
    act(() => {
      emitter.emit(APP_EVENTS.FOLDER_OUTLINE_CHANGED);
      emitter.emit(APP_EVENTS.SERVER_LIMIT_CHANGED);
      window.dispatchEvent(new Event('focus'));
    });
    expect(quota).toHaveBeenCalledTimes(1);
  });

  it('refreshes the plan and quotas after billing changes and a return from checkout', async () => {
    const { result } = mount();

    await waitFor(() => expect(result.current.getAction(ViewLayout.Timeline).type).toBe('upgrade'));
    subscriptions.mockResolvedValue([subscription(SubscriptionPlan.Team)]);
    act(() => {
      emitter.emit(APP_EVENTS.SERVER_LIMIT_CHANGED);
    });
    await waitFor(() => expect(result.current.getAction(ViewLayout.Timeline).type).toBe('create'));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(subscriptions).toHaveBeenCalledTimes(3));
  });

  it('shares in-flight billing reads across menus and reuses them on reopen until expiry', async () => {
    const pending = deferred<Subscription[]>();
    const now = Date.now();

    jest.spyOn(Date, 'now').mockReturnValue(now);
    subscriptions.mockReturnValueOnce(pending.promise);
    const first = mount();
    const second = mount();

    await waitFor(() => expect(subscriptions).toHaveBeenCalledTimes(1));
    await act(async () => pending.resolve([]));
    await waitFor(() => expect(second.result.current.getAction(ViewLayout.Timeline).type).toBe('upgrade'));
    first.unmount();
    second.rerender({ open: false });
    second.rerender({ open: true });
    await waitFor(() => expect(quota).toHaveBeenCalledTimes(3));
    expect(subscriptions).toHaveBeenCalledTimes(1);
    jest.mocked(Date.now).mockReturnValue(now + 30_001);
    second.rerender({ open: false });
    second.rerender({ open: true });
    await waitFor(() => expect(subscriptions).toHaveBeenCalledTimes(2));
  });

  it('keeps known crowns but not stale allowances during a background refresh, without another billing read', async () => {
    const pending = deferred<typeof allowed>();
    const { result } = mount();

    await waitFor(() => expect(result.current.getAction(ViewLayout.Form).type).toBe('create'));
    quota.mockReturnValueOnce(pending.promise);
    act(() => {
      emitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED);
    });
    expect(result.current.getAction(ViewLayout.Form)).toMatchObject({
      type: 'disabled',
      reason: 'databaseViewCreation.checking',
    });
    expect(result.current.getAction(ViewLayout.Timeline).type).toBe('upgrade');
    await act(async () => pending.resolve({ can_create_form: false, can_create_chart: true }));
    expect(result.current.getAction(ViewLayout.Form)).toMatchObject({ type: 'upgrade', requiresPro: true });
    expect(result.current.getAction(ViewLayout.Chart).type).toBe('create');
    expect(subscriptions).toHaveBeenCalledTimes(1);
  });

  it('keeps a confirmed crown after a failed refresh while the stale allowance stays unavailable', async () => {
    quota.mockResolvedValueOnce({ can_create_form: true, can_create_chart: false });
    const { result } = mount();

    await waitFor(() => expect(result.current.getAction(ViewLayout.Chart).type).toBe('upgrade'));
    quota.mockRejectedValueOnce(new Error('Server unavailable'));
    await act(async () => {
      emitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED);
    });
    expect(result.current.getAction(ViewLayout.Chart)).toMatchObject({ type: 'upgrade', requiresPro: true });
    expect(result.current.getAction(ViewLayout.Form)).toMatchObject({
      type: 'disabled',
      reason: 'databaseViewCreation.unavailable',
    });
  });

  it('uses the Desktop upgrade message for each limited layout', async () => {
    quota.mockResolvedValue({ can_create_form: false, can_create_chart: false });
    const { result } = mount();

    await waitFor(() => expect(result.current.getAction(ViewLayout.Form).type).toBe('upgrade'));
    await waitFor(() => expect(result.current.getAction(ViewLayout.Timeline).type).toBe('upgrade'));
    expect(result.current.getAction(ViewLayout.Form).reason).toBe('databaseViewCreation.upgradeForm');
    expect(result.current.getAction(ViewLayout.Chart).reason).toBe('databaseViewCreation.upgradeChart');
    expect(result.current.getAction(ViewLayout.Timeline).reason).toBe('databaseViewCreation.upgradeTimeline');
  });

  it('does not trust a remembered allowance when the menu reopens, but keeps known crowns', async () => {
    quota.mockResolvedValueOnce({ can_create_form: true, can_create_chart: false });
    // Record every render: an effect could hide a stale first frame from result.current.
    const rendered: Array<{ open: boolean; form: string; chart: string }> = [];
    const { result, rerender } = renderHook(
      ({ open }) => {
        const creation = useDatabaseViewCreation({ workspaceId, getSubscriptions: subscriptions, enabled: open });

        rendered.push({
          open,
          form: creation.getAction(ViewLayout.Form).type,
          chart: creation.getAction(ViewLayout.Chart).type,
        });
        return creation;
      },
      { initialProps: { open: true }, wrapper: Wrapper }
    );

    await waitFor(() => expect(result.current.getAction(ViewLayout.Form).type).toBe('create'));
    const pending = deferred<typeof allowed>();

    quota.mockReturnValueOnce(pending.promise);
    rerender({ open: false });
    rendered.length = 0;
    rerender({ open: true });
    expect(rendered.length).toBeGreaterThan(0);
    for (const frame of rendered) expect(frame).toEqual({ open: true, form: 'disabled', chart: 'upgrade' });
    await act(async () => pending.resolve({ can_create_form: true, can_create_chart: false }));
    expect(result.current.getAction(ViewLayout.Form).type).toBe('create');
  });

  it('clears the quota snapshot when the connection drops', async () => {
    quota.mockResolvedValueOnce({ can_create_form: false, can_create_chart: true });
    const { result } = mount();

    await waitFor(() => expect(result.current.getAction(ViewLayout.Form).type).toBe('upgrade'));
    const pending = deferred<typeof allowed>();

    quota.mockReturnValueOnce(pending.promise);
    act(() => {
      emitter.webSocketReadyState = 3;
      emitter.emit(APP_EVENTS.WEBSOCKET_STATUS);
    });
    act(() => {
      emitter.webSocketReadyState = 1;
      emitter.emit(APP_EVENTS.WEBSOCKET_STATUS);
    });
    expect(result.current.getAction(ViewLayout.Form)).toMatchObject({
      type: 'disabled',
      reason: 'databaseViewCreation.checking',
    });
    await act(async () => pending.resolve({ can_create_form: false, can_create_chart: true }));
    expect(result.current.getAction(ViewLayout.Form).type).toBe('upgrade');
  });

  it('does not restore an invalidated in-flight plan after another menu fetches the new plan', async () => {
    const pending = deferred<Subscription[]>();

    subscriptions.mockReturnValueOnce(pending.promise);
    const first = mount();

    await waitFor(() => expect(subscriptions).toHaveBeenCalledTimes(1));
    act(() => {
      emitter.emit(APP_EVENTS.SERVER_LIMIT_CHANGED);
    });
    const second = mount();

    await waitFor(() => expect(second.result.current.getAction(ViewLayout.Timeline).type).toBe('upgrade'));
    await act(async () => pending.resolve([subscription(SubscriptionPlan.Pro)]));
    await waitFor(() => expect(first.result.current.getAction(ViewLayout.Timeline).type).toBe('upgrade'));
    expect(second.result.current.getAction(ViewLayout.Timeline).type).toBe('upgrade');
    expect(subscriptions).toHaveBeenCalledTimes(2);
  });

  it('invalidates billing while closed without fetching until a menu opens', async () => {
    const { result, rerender } = mount();

    await waitFor(() => expect(result.current.getAction(ViewLayout.Timeline).type).toBe('upgrade'));
    rerender({ open: false });
    subscriptions.mockResolvedValue([subscription(SubscriptionPlan.Pro)]);
    act(() => {
      emitter.emit(APP_EVENTS.SERVER_LIMIT_CHANGED);
    });
    expect(subscriptions).toHaveBeenCalledTimes(1);
    expect(quota).toHaveBeenCalledTimes(1);
    rerender({ open: true });
    await waitFor(() => expect(result.current.getAction(ViewLayout.Timeline).type).toBe('create'));
    expect(subscriptions).toHaveBeenCalledTimes(2);
  });

  it('does not copy a previous workspace plan when the new quota responds first', async () => {
    subscriptions.mockResolvedValue([subscription(SubscriptionPlan.Pro)]);
    const { result, rerender } = mount();

    await waitFor(() => expect(result.current.getAction(ViewLayout.Timeline).type).toBe('create'));
    const pending = deferred<Subscription[]>();

    subscriptions.mockReturnValueOnce(pending.promise);
    workspaceId = 'new-workspace-with-pending-plan';
    rerender({ open: true });
    await waitFor(() => expect(result.current.getAction(ViewLayout.Chart).type).toBe('create'));
    expect(result.current.getAction(ViewLayout.Timeline)).toMatchObject({
      type: 'disabled',
      reason: 'databaseViewCreation.checking',
    });
    await act(async () => pending.resolve([]));
    expect(result.current.getAction(ViewLayout.Timeline).type).toBe('upgrade');
  });
});
