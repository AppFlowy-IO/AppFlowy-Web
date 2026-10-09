import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { APP_EVENTS } from '@/application/constants';
import { Role, SubscriptionInterval, SubscriptionPlan, View, ViewLayout, Workspace } from '@/application/types';
import { AppEventEmitter, AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import AddPageActions from '@/components/app/view-actions/AddPageActions';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getConfigValue } from '@/utils/runtime-config';
import { updateServerInfo } from '@/utils/server-info';

import { AddViewButton } from '../AddViewButton';

const mockGetSubscriptions = jest.fn();
const mockAddPage = jest.fn();
const mockAddView = jest.fn();
const mockQuota = jest.fn();
const mockCheckout = jest.fn();
let mockRole = Role.Member;
const emitter: AppEventEmitter = new EventEmitter();

emitter.webSocketReadyState = 1;
let mockWorkspaceId = '';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
jest.mock('@/application/services/js-services/http/workspace-api', () => ({
  getDatabaseViewCreationStatus: (...args: unknown[]) => mockQuota(...args),
}));
jest.mock('@/application/services/domains/billing', () => ({
  getSubscriptionLink: (...args: unknown[]) => mockCheckout(...args),
}));
jest.mock('@/utils/runtime-config', () => ({
  ...jest.requireActual('@/utils/runtime-config'),
  isDevelopmentOrTestEnvironment: () => false,
}));
jest.mock('@/application/database-yjs/context', () => ({
  useDatabaseContext: () => ({ workspaceId: mockWorkspaceId, getSubscriptions: mockGetSubscriptions }),
}));
jest.mock('@/application/database-yjs/dispatch', () => ({ useAddDatabaseView: () => mockAddView }));
jest.mock('@/components/app/app.hooks', () => ({
  useAIEnabled: () => false,
  useAppOperations: () => ({ addPage: mockAddPage, getSubscriptions: mockGetSubscriptions }),
  useCurrentWorkspaceId: () => mockWorkspaceId,
  useOpenPageModal: () => undefined,
  useScheduleDeferredCleanup: () => undefined,
  useToView: () => jest.fn(),
}));
jest.mock('@/application/services/js-services/http', () => ({ getAxiosInstance: () => ({}) }));
jest.mock('@/components/chat/request', () => ({ ChatRequest: jest.fn() }));

const parent: View = {
  view_id: 'parent',
  name: 'Parent',
  icon: null,
  layout: ViewLayout.Document,
  extra: { is_space: false },
  children: [],
  is_published: false,
  is_private: false,
};

const initialLocation = '/app/workspace/page?existing=value';

function LocationProbe() {
  const { pathname, search } = useLocation();

  return <output data-testid='current-location'>{pathname}{search}</output>;
}

function expectPlanComparison() {
  const location = new URL(screen.getByTestId('current-location').textContent!, 'https://appflowy.cloud');

  expect(location.pathname).toBe('/app/workspace/page');
  expect(location.searchParams.get('existing')).toBe('value');
  expect(location.searchParams.get('action')).toBe('change_plan');
}

function CreationMenu({ surface, showMenu = true }: { surface: 'page' | 'view'; showMenu?: boolean }) {
  return (
    <MemoryRouter initialEntries={[initialLocation]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <LocationProbe />
      <AuthInternalContext.Provider
        value={{
          isAuthenticated: true,
          onChangeWorkspace: jest.fn(),
          currentWorkspaceId: mockWorkspaceId,
          userWorkspaceInfo: {
            userId: 'user',
            workspaces: [],
            selectedWorkspace: { id: mockWorkspaceId, role: mockRole } as Workspace,
          },
        }}
      >
        <AppEventEmitterContext.Provider value={emitter}>
          {showMenu && (surface === 'view' ? (
            <AddViewButton databasePageId='database' onViewAdded={() => undefined} />
          ) : (
            <DropdownMenu defaultOpen>
              <DropdownMenuTrigger>New page</DropdownMenuTrigger>
              <DropdownMenuContent>
                <AddPageActions view={parent} />
              </DropdownMenuContent>
            </DropdownMenu>
          ))}
        </AppEventEmitterContext.Provider>
      </AuthInternalContext.Provider>
    </MemoryRouter>
  );
}

describe.each(['page', 'view'] as const)('Database %s creation menu', (surface) => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = Role.Member;
    emitter.webSocketReadyState = 1;
    mockGetSubscriptions.mockReset().mockResolvedValue([]);
    mockAddPage.mockReset().mockResolvedValue({ view_id: 'created-page' });
    mockAddView.mockReset().mockResolvedValue('created-view');
    mockQuota.mockReset().mockResolvedValue({ can_create_form: true, can_create_chart: true });
    mockCheckout.mockResolvedValue('https://checkout.example/pro');
    updateServerInfo(getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'), {
      status: 'available',
      info: { enable_page_history: true, self_hosted: false },
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('greys out Free with a hover tooltip, then enables creation in a Pro workspace', async () => {
    mockWorkspaceId = `${surface}-free`;
    mockGetSubscriptions.mockResolvedValue([]);
    mockAddPage.mockReset().mockResolvedValue({ view_id: 'created-page' });
    mockAddView.mockReset().mockResolvedValue('created-view');
    const { rerender } = render(<CreationMenu surface={surface} />);

    if (surface === 'view') {
      fireEvent.keyDown(screen.getByTestId('add-view-button'), { key: 'ArrowDown' });
    }

    const timeline = await screen.findByTestId(`add-timeline-${surface}-button`);
    const message = 'databaseViewCreation.askOwner';

    // The disabled item ignores pointer events; its wrapper must receive hover.
    fireEvent.pointerMove(timeline.parentElement!, { pointerType: 'mouse' });
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe(message));
    expect(within(timeline).queryByLabelText('Pro')).toBeNull();
    expect(timeline.getAttribute('aria-disabled')).toBe('true');
    expect(timeline.className).toContain('data-[disabled]:text-text-tertiary');
    fireEvent.click(timeline);
    expect(mockAddPage).not.toHaveBeenCalled();
    expect(mockAddView).not.toHaveBeenCalled();
    fireEvent.pointerLeave(timeline.parentElement!);

    mockWorkspaceId = `${surface}-pro`;
    mockGetSubscriptions.mockResolvedValue([
      {
        plan: SubscriptionPlan.Pro,
        currency: 'USD',
        price_cents: 1000,
        recurring_interval: SubscriptionInterval.Month,
      },
    ]);
    rerender(<CreationMenu surface={surface} />);
    await waitFor(() =>
      expect(screen.getByTestId(`add-timeline-${surface}-button`).hasAttribute('data-disabled')).toBe(false)
    );
    fireEvent.click(screen.getByTestId(`add-timeline-${surface}-button`));
    await waitFor(() => expect(surface === 'page' ? mockAddPage : mockAddView).toHaveBeenCalledTimes(1));
  });
  it.each(['timeline', 'chart', 'form'] as const)(
    'offers the owner a %s crown and opens plan comparison before checkout, without creating a view',
    async (layout) => {
      mockWorkspaceId = `${surface}-${layout}-owner`;
      mockRole = Role.Owner;
      mockGetSubscriptions.mockResolvedValue([]);
      mockQuota.mockResolvedValue({ can_create_form: false, can_create_chart: false });
      const openCheckout = jest.spyOn(window, 'open').mockReturnValue(null);

      openMenu();
      const clicked = await waitFor(() => {
        const element = item(layout);

        expect(within(element).getByLabelText('Pro')).toBeTruthy();
        return element;
      });

      expect(clicked.hasAttribute('data-disabled')).toBe(false);
      fireEvent.click(clicked);
      // A repeated upgrade click must still wait for a billing-period choice.
      fireEvent.click(clicked);
      await waitFor(expectPlanComparison);
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(mockCheckout).not.toHaveBeenCalled();
      expect(openCheckout).not.toHaveBeenCalled();
      expect(mockAddPage).not.toHaveBeenCalled();
      expect(mockAddView).not.toHaveBeenCalled();
      if (surface === 'view') {
        fireEvent.keyDown(screen.getByTestId('add-view-button'), { key: 'ArrowDown' });
        await waitFor(() => expect(within(item(layout)).getByLabelText('Pro')).toBeTruthy());
        expect(item(layout).hasAttribute('data-disabled')).toBe(false);
        expect(screen.queryByRole('progressbar')).toBeNull();
      }
    }
  );

  if (surface === 'view') {
    it('reuses the Timeline result immediately while checking billing again on every open', async () => {
      mockWorkspaceId = 'view-reopen-billing-cache';
      mockRole = Role.Owner;
      mockGetSubscriptions.mockResolvedValue([
        { plan: SubscriptionPlan.Pro, currency: 'USD', price_cents: 1000, recurring_interval: SubscriptionInterval.Month },
      ]);
      openMenu();
      await waitFor(() => expect(item('timeline').hasAttribute('data-disabled')).toBe(false));
      expect(within(item('timeline')).queryByLabelText('Pro')).toBeNull();

      for (let opening = 2; opening <= 3; opening += 1) {
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
        let resolve!: (value: unknown[]) => void;

        mockGetSubscriptions.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
        fireEvent.keyDown(screen.getByTestId('add-view-button'), { key: 'ArrowDown' });
        expect(item('timeline').hasAttribute('data-disabled')).toBe(false);
        expect(within(item('timeline')).queryByLabelText('Pro')).toBeNull();
        expect(screen.queryByText('databaseViewCreation.checking')).toBeNull();
        await waitFor(() => expect(mockGetSubscriptions).toHaveBeenCalledTimes(opening));
        await act(async () => resolve(opening === 3 ? [] : [{ plan: SubscriptionPlan.Pro }]));
      }

      expect(within(item('timeline')).getByLabelText('Pro')).toBeTruthy();
      expect(mockAddView).not.toHaveBeenCalled();
    });

    it('keeps plan comparison open when the add button unmounts before the handoff settles', async () => {
      mockWorkspaceId = 'view-plan-comparison-unmount';
      mockRole = Role.Owner;
      mockQuota.mockResolvedValue({ can_create_form: false, can_create_chart: false });
      const openCheckout = jest.spyOn(window, 'open').mockReturnValue(null);
      const errors = jest.spyOn(console, 'error');
      const menu = render(<CreationMenu surface={surface} />);

      fireEvent.keyDown(screen.getByTestId('add-view-button'), { key: 'ArrowDown' });
      await waitFor(() => expect(within(item('timeline')).getByLabelText('Pro')).toBeTruthy());
      fireEvent.click(item('timeline'));
      menu.rerender(<CreationMenu surface={surface} showMenu={false} />);
      await waitFor(expectPlanComparison);
      expect(screen.queryByTestId('add-view-button')).toBeNull();
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(mockCheckout).not.toHaveBeenCalled();
      expect(openCheckout).not.toHaveBeenCalled();
      expect(mockAddView).not.toHaveBeenCalled();
      expect(errors).not.toHaveBeenCalled();
    });
  }

  it.each(['form', 'chart'] as const)('allows the first %s without a crown', async (layout) => {
    mockWorkspaceId = `${surface}-first-${layout}`;
    mockGetSubscriptions.mockResolvedValue([]);
    render(<CreationMenu surface={surface} />);
    if (surface === 'view') fireEvent.keyDown(screen.getByTestId('add-view-button'), { key: 'ArrowDown' });
    const form = await screen.findByTestId(surface === 'view' ? 'add-form-view-option' : 'add-form-button');

    await waitFor(() => expect(form.hasAttribute('data-disabled')).toBe(false));
    expect(within(form).queryByLabelText('Pro')).toBeNull();
    const chart = surface === 'page' ? screen.getByTestId('add-chart-button') : screen.getByText('chart.menuName');

    expect(chart.hasAttribute('data-disabled')).toBe(false);
    expect(within(chart).queryByLabelText('Pro')).toBeNull();
    fireEvent.click(layout === 'form' ? form : chart);
    await waitFor(() => expect(surface === 'page' ? mockAddPage : mockAddView).toHaveBeenCalledTimes(1));
    expect(mockCheckout).not.toHaveBeenCalled();
    expect(screen.getByTestId('current-location').textContent).toBe(initialLocation);
  });

  function item(layout: 'form' | 'chart' | 'timeline') {
    if (layout === 'timeline') return screen.getByTestId(`add-timeline-${surface}-button`);
    if (layout === 'form') return screen.getByTestId(surface === 'view' ? 'add-form-view-option' : 'add-form-button');
    return surface === 'page' ? screen.getByTestId('add-chart-button') : screen.getByText('chart.menuName');
  }

  function openMenu() {
    render(<CreationMenu surface={surface} />);
    if (surface === 'view') fireEvent.keyDown(screen.getByTestId('add-view-button'), { key: 'ArrowDown' });
  }

  it.each([Role.Member, Role.Guest])('disables exhausted allowances for role %s without crowns', async (role) => {
    mockWorkspaceId = `${surface}-exhausted-${role}`;
    mockRole = role;
    mockQuota.mockResolvedValue({ can_create_form: false, can_create_chart: false });
    openMenu();
    const form = item('form');

    fireEvent.pointerMove(form.parentElement!, { pointerType: 'mouse' });
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe('databaseViewCreation.askOwner'));
    for (const layout of ['form', 'chart', 'timeline'] as const) {
      expect(item(layout).getAttribute('aria-disabled')).toBe('true');
      expect(within(item(layout)).queryByLabelText('Pro')).toBeNull();
      fireEvent.click(item(layout));
    }

    expect(mockCheckout).not.toHaveBeenCalled();
    expect(screen.getByTestId('current-location').textContent).toBe(initialLocation);
    expect(mockAddPage).not.toHaveBeenCalled();
    expect(mockAddView).not.toHaveBeenCalled();
  });

  it('loads pre-existing quotas and updates only the exhausted crown while the menu stays open', async () => {
    mockWorkspaceId = `${surface}-live-quotas`;
    mockRole = Role.Owner;
    let resolve!: (quota: { can_create_form: boolean; can_create_chart: boolean }) => void;

    mockQuota.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    openMenu();
    const form = item('form');
    const chart = item('chart');

    expect(form.getAttribute('aria-disabled')).toBe('true');
    expect(within(form).queryByLabelText('Pro')).toBeNull();
    expect(within(chart).queryByLabelText('Pro')).toBeNull();
    await act(async () => resolve({ can_create_form: false, can_create_chart: true }));
    expect(item('form')).toBe(form);
    expect(within(form).getByLabelText('Pro')).toBeTruthy();
    expect(within(chart).queryByLabelText('Pro')).toBeNull();
    mockQuota.mockResolvedValue({ can_create_form: true, can_create_chart: false });
    act(() => {
      emitter.emit(APP_EVENTS.FOLDER_OUTLINE_CHANGED);
    });
    // Keep the confirmed menu state visible while the new quotas load.
    expect(within(form).getByLabelText('Pro')).toBeTruthy();
    expect(chart.hasAttribute('data-disabled')).toBe(false);
    await waitFor(() => expect(within(chart).getByLabelText('Pro')).toBeTruthy());
    expect(within(form).queryByLabelText('Pro')).toBeNull();
    expect(mockGetSubscriptions).toHaveBeenCalledTimes(1);
    expect(mockAddPage).not.toHaveBeenCalled();
    expect(mockAddView).not.toHaveBeenCalled();
  });

  it.each([true, false])('bypasses every creation limit on self-hosted instances (online=%s)', async (online) => {
    mockWorkspaceId = `${surface}-self-hosted-${online}`;
    mockRole = Role.Guest;
    emitter.webSocketReadyState = online ? 1 : 3;
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
    mockQuota.mockRejectedValue(new Error('No hosted quotas'));
    mockGetSubscriptions.mockRejectedValue(new Error('No billing'));
    updateServerInfo(getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'), {
      status: 'available',
      info: { enable_page_history: true, self_hosted: true },
    });
    // Repeated real menu clicks exceed all hosted trial allowances.
    for (const layout of ['form', 'chart', 'timeline', 'form', 'chart', 'timeline'] as const) {
      const menu = render(<CreationMenu surface={surface} />);

      if (surface === 'view') fireEvent.keyDown(screen.getByTestId('add-view-button'), { key: 'ArrowDown' });
      expect(item(layout).hasAttribute('data-disabled')).toBe(false);
      expect(within(item(layout)).queryByLabelText('Pro')).toBeNull();
      fireEvent.click(item(layout));
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      menu.unmount();
    }

    expect(surface === 'page' ? mockAddPage : mockAddView).toHaveBeenCalledTimes(6);
    expect(mockQuota).not.toHaveBeenCalled();
    expect(mockGetSubscriptions).not.toHaveBeenCalled();
    expect(mockCheckout).not.toHaveBeenCalled();
  });
});
