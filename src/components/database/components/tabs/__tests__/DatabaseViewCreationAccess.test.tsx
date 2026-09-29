import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { Role, SubscriptionInterval, SubscriptionPlan, View, ViewLayout, Workspace } from '@/application/types';
import { APP_EVENTS } from '@/application/constants';
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

jest.mock('@/application/constants', () => ({
  ...jest.requireActual('@/application/constants'),
  EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED: true,
}));
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

function CreationMenu({ surface }: { surface: 'page' | 'view' }) {
  return (
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
          {surface === 'view' ? (
            <AddViewButton databasePageId='database' onViewAdded={() => undefined} />
          ) : (
            <DropdownMenu defaultOpen>
              <DropdownMenuTrigger>New page</DropdownMenuTrigger>
              <DropdownMenuContent>
                <AddPageActions view={parent} />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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
    mockGetSubscriptions.mockResolvedValue([]);
    mockAddPage.mockReset().mockResolvedValue({ view_id: 'created-page' });
    mockAddView.mockReset().mockResolvedValue('created-view');
    mockQuota.mockResolvedValue({ can_create_form: true, can_create_chart: true });
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
    'offers the owner a %s crown and checkout without creating a view',
    async (layout) => {
      mockWorkspaceId = `${surface}-${layout}-owner`;
      mockRole = Role.Owner;
      mockGetSubscriptions.mockResolvedValue([]);
      mockQuota.mockResolvedValue({ can_create_form: false, can_create_chart: false });
      const openWindow = jest.spyOn(window, 'open').mockReturnValue(null);

      render(<CreationMenu surface={surface} />);
      if (surface === 'view') fireEvent.keyDown(screen.getByTestId('add-view-button'), { key: 'ArrowDown' });
      const item =
        layout === 'timeline'
          ? await screen.findByTestId(`add-timeline-${surface}-button`)
          : layout === 'form'
          ? await screen.findByTestId(surface === 'view' ? 'add-form-view-option' : 'add-form-button')
          : surface === 'page'
          ? await screen.findByTestId('add-chart-button')
          : await screen.findByText('chart.menuName');

      await waitFor(() => expect(within(item).getByLabelText('Pro')).toBeTruthy());
      expect(item.hasAttribute('data-disabled')).toBe(false);
      fireEvent.click(item);
      await waitFor(() =>
        expect(mockCheckout).toHaveBeenCalledWith(mockWorkspaceId, SubscriptionPlan.Pro, SubscriptionInterval.Year)
      );
      expect(mockAddPage).not.toHaveBeenCalled();
      expect(mockAddView).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      openWindow.mockRestore();
    }
  );

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
