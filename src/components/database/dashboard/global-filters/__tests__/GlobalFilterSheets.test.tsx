import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { SelectOptionFilterCondition } from '@/application/database-yjs/fields/select-option/select_option.type';

import { GlobalFilterBar } from '../GlobalFilterBar';
import { GlobalFilterButton } from '../GlobalFilterButton';
import { requestGlobalFilterEditor } from '../pendingEditorStore';

import { createTestContext, done, installPointerEvents, MockDashboard } from './global-filter-test-context';

let mockContext: MockDashboard | null = null;

jest.mock('@/components/database/dashboard/DashboardContext', () => {
  const required = () => {
    if (!mockContext) throw new Error('DashboardContext is not provided');
    return mockContext;
  };

  return {
    useDashboardContext: required,
    useDashboardLayout: required,
    useDashboardFilters: required,
    useDashboardSources: required,
    useDashboardContextOptional: () => mockContext,
    useDashboardPrivateSummary: () => mockContext?.summary,
  };
});
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => undefined }));
jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => ({
  useMentionableUsersWithAutoFetch: () => ({ users: [], loading: false }),
}));
jest.mock('react-i18next', () => {
  const { MOCK_TRANSLATE: translate } = jest.requireActual('./global-filter-test-context');

  return { useTranslation: () => ({ t: translate }) };
});

beforeAll(installPointerEvents);

afterEach(() => {
  mockContext = null;
});

const statusFilter: DashboardGlobalFilter = {
  id: 'gf:status',
  name: 'Status',
  fieldType: FieldType.SingleSelect,
  condition: SelectOptionFilterCondition.OptionIs,
  content: done.id,
  targets: { 'db-projects': 'p-status', 'db-tasks': 't-stage' },
};

function phone(overrides: Partial<MockDashboard> = {}) {
  return createTestContext({ mobileContext: true, canEnterEdit: false, isEditing: false, ...overrides });
}

const sheet = () => screen.getByTestId('mobile-sheet');
const menu = () => screen.findByTestId('dashboard-global-filter-menu');

describe('global filter surfaces on a phone (WP14 §1.4.2)', () => {
  it('opens the toolbar Filter button as a "Filter" sheet on the property picker', async () => {
    mockContext = phone();
    render(<GlobalFilterButton />);
    fireEvent.click(screen.getByTestId('dashboard-global-filter-button'));

    const opened = await menu();

    expect(sheet().getAttribute('data-sheet')).toBe('global-filter');
    expect(within(sheet()).getByTestId('mobile-sheet-title').textContent).toBe('Filter');
    expect(opened.getAttribute('data-entry')).toBe('toolbar');
    expect(opened.getAttribute('data-variant')).toBe('sheet');
    expect(opened.getAttribute('data-screen')).toBe('picker');
    // No popover on a phone, and no back on the first screen.
    expect(screen.queryByTestId('dashboard-global-filter-popover')).toBeNull();
    expect(screen.queryByTestId('mobile-sheet-back')).toBeNull();
    expect(screen.getByTestId('dashboard-global-filter-button').getAttribute('data-state')).toBe('open');
  });

  it('pushes the multiple-sources screens inside the sheet, going back through its header', async () => {
    mockContext = phone();
    render(<GlobalFilterButton />);
    fireEvent.click(screen.getByTestId('dashboard-global-filter-button'));
    await menu();

    fireEvent.click(screen.getByTestId('dashboard-global-filter-multiple-sources'));
    expect(screen.getByTestId('dashboard-global-filter-menu').getAttribute('data-screen')).toBe('multi-intro');
    // The sheet's header closes it: the intro draws no close button of its own.
    expect(
      within(screen.getByTestId('dashboard-global-filter-multi-intro')).queryByRole('button', { name: 'Close' })
    ).toBeNull();
    fireEvent.click(screen.getByTestId('dashboard-global-filter-add-to-filter'));
    expect(screen.getByTestId('dashboard-global-filter-menu').getAttribute('data-screen')).toBe('multi-picker');
    // No inner back row: the sheet header's chevron goes back.
    expect(screen.queryByTestId('dashboard-global-filter-back')).toBeNull();

    fireEvent.click(await screen.findByTestId('mobile-sheet-back'));
    expect(screen.getByTestId('dashboard-global-filter-menu').getAttribute('data-screen')).toBe('multi-intro');
    fireEvent.click(screen.getByTestId('mobile-sheet-back'));
    expect(screen.getByTestId('dashboard-global-filter-menu').getAttribute('data-screen')).toBe('picker');
    await waitFor(() => expect(screen.queryByTestId('mobile-sheet-back')).toBeNull());
  });

  it('opens a pill as a sheet titled with its label, on its editor', async () => {
    mockContext = phone({ globalFilters: [statusFilter], effectiveGlobalFilters: [statusFilter] });
    render(<GlobalFilterBar />);
    const chip = screen.getByTestId('dashboard-global-filter-chip');
    const label = screen.getByTestId('dashboard-global-filter-chip-label').textContent;

    fireEvent.click(chip);
    const opened = await menu();

    expect(sheet().getAttribute('data-sheet')).toBe('global-filter-pill');
    expect(within(sheet()).getByTestId('mobile-sheet-title').textContent).toBe(label);
    expect(opened.getAttribute('data-entry')).toBe('pill');
    expect(opened.getAttribute('data-screen')).toBe('pill');
    expect(screen.getByTestId('dashboard-global-filter-pill-editor').getAttribute('data-filter-id')).toBe('gf:status');
    expect(screen.queryByTestId('dashboard-global-filter-chip-tooltip')).toBeNull();
  });

  it("goes back from a pill's builder to its editor through the sheet header", async () => {
    mockContext = phone({ globalFilters: [statusFilter], effectiveGlobalFilters: [statusFilter] });
    render(<GlobalFilterBar />);
    fireEvent.click(screen.getByTestId('dashboard-global-filter-chip'));
    await menu();

    // The pill editor's ··· (a Radix dropdown, kept on a phone) › Filter multiple sources.
    fireEvent.pointerDown(screen.getByTestId('dashboard-global-filter-more-actions'), {
      button: 0,
      pointerType: 'mouse',
    });
    fireEvent.click(await screen.findByTestId('dashboard-global-filter-open-builder'));
    expect(screen.getByTestId('dashboard-global-filter-menu').getAttribute('data-screen')).toBe('builder');
    expect(screen.queryByTestId('dashboard-global-filter-back')).toBeNull();

    fireEvent.click(await screen.findByTestId('mobile-sheet-back'));
    expect(screen.getByTestId('dashboard-global-filter-menu').getAttribute('data-screen')).toBe('pill');
  });

  it('opens the bar\'s + Filter as a "Filter" sheet for writers', async () => {
    mockContext = phone({ globalFilters: [statusFilter], effectiveGlobalFilters: [statusFilter] });
    render(<GlobalFilterBar />);
    fireEvent.click(screen.getByTestId('dashboard-global-filter-bar-add'));

    const opened = await menu();

    expect(sheet().getAttribute('data-sheet')).toBe('global-filter');
    expect(within(sheet()).getByTestId('mobile-sheet-title').textContent).toBe('Filter');
    expect(opened.getAttribute('data-entry')).toBe('bar-add');
  });

  it("still opens a pill's sheet on a pending-editor request (a pick in the toolbar menu)", async () => {
    mockContext = phone({ globalFilters: [statusFilter], effectiveGlobalFilters: [statusFilter] });
    render(<GlobalFilterBar />);
    act(() => requestGlobalFilterEditor('gf:status'));

    expect(await screen.findByTestId('dashboard-global-filter-pill-editor')).toBeTruthy();
    expect(sheet().getAttribute('data-sheet')).toBe('global-filter-pill');
  });

  it('gives a reader the list of the filters in the toolbar sheet', async () => {
    mockContext = phone({ canEdit: false, globalFilters: [statusFilter], effectiveGlobalFilters: [statusFilter] });
    render(<GlobalFilterButton />);
    fireEvent.click(screen.getByTestId('dashboard-global-filter-button'));

    expect((await menu()).getAttribute('data-screen')).toBe('reader-list');
    expect(screen.getAllByTestId('dashboard-global-filter-reader-item')).toHaveLength(1);
  });
});

describe('global filter surfaces on desktop', () => {
  it('keeps the 290px popovers', async () => {
    mockContext = createTestContext({ globalFilters: [statusFilter], effectiveGlobalFilters: [statusFilter] });
    render(
      <>
        <GlobalFilterBar />
        <GlobalFilterButton />
      </>
    );

    fireEvent.click(screen.getByTestId('dashboard-global-filter-button'));
    const opened = await menu();

    expect(opened.getAttribute('data-variant')).toBe('popover');
    expect(screen.getByTestId('dashboard-global-filter-popover').style.width).toBe('290px');
    expect(screen.queryByTestId('mobile-sheet')).toBeNull();
  });
});
