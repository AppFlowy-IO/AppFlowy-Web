import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { SubscriptionInterval, SubscriptionPlan, View, ViewLayout } from '@/application/types';
import AddPageActions from '@/components/app/view-actions/AddPageActions';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import { AddViewButton } from '../AddViewButton';

const mockGetSubscriptions = jest.fn();
const mockAddPage = jest.fn();
const mockAddView = jest.fn();
let mockWorkspaceId = '';

jest.mock('@/application/constants', () => ({
  ...jest.requireActual('@/application/constants'),
  EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED: true,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
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
    <MemoryRouter>
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
    </MemoryRouter>
  );
}

describe.each(['page', 'view'] as const)('Timeline %s creation menu', (surface) => {
  it.each([SubscriptionPlan.Pro, SubscriptionPlan.Team])('greys out Free with a hover tooltip, then enables creation in a %s workspace', async (plan) => {
    mockWorkspaceId = `${surface}-${plan}-free`;
    mockGetSubscriptions.mockResolvedValue([]);
    mockAddPage.mockReset().mockResolvedValue({ view_id: 'created-page' });
    mockAddView.mockReset().mockResolvedValue('created-view');
    const { rerender } = render(<CreationMenu surface={surface} />);

    if (surface === 'view') {
      fireEvent.keyDown(screen.getByTestId('add-view-button'), { key: 'ArrowDown' });
    }

    const timeline = await screen.findByTestId(`add-timeline-${surface}-button`);
    const message = 'Creating a Timeline view requires a Pro workspace.';

    // The disabled item ignores pointer events; its wrapper must receive hover.
    fireEvent.pointerMove(timeline.parentElement!, { pointerType: 'mouse' });
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe(message));
    expect(timeline.getAttribute('aria-disabled')).toBe('true');
    expect(timeline.className).toContain('data-[disabled]:text-text-tertiary');
    expect(timeline.className).toContain('[&_svg]:text-text-tertiary');
    fireEvent.click(timeline);
    expect(mockAddPage).not.toHaveBeenCalled();
    expect(mockAddView).not.toHaveBeenCalled();
    fireEvent.pointerLeave(timeline.parentElement!);

    mockWorkspaceId = `${surface}-${plan}-paid`;
    mockGetSubscriptions.mockResolvedValue([
      {
        plan,
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
});
