import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { DashboardGlobalFilter, DashboardLayoutUpdate } from '@/application/database-yjs/dashboard.type';

import { GlobalFilterMenu } from '../GlobalFilterMenu';
import { clearGlobalFilterEditorRequest, getPendingGlobalFilterEditor } from '../pendingEditorStore';

import { createTestContext, installPointerEvents, MockDashboard } from './global-filter-test-context';

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
  clearGlobalFilterEditorRequest();
});

function Harness({ onClose = jest.fn() }: { onClose?: () => void }) {
  const [filters, setFilters] = useState<DashboardGlobalFilter[]>([]);

  mockContext = createTestContext({
    globalFilters: filters,
    effectiveGlobalFilters: filters,
    updateSetting: (update: DashboardLayoutUpdate) => {
      if (update.globalFilters) setFilters(update.globalFilters);
    },
  });
  return <GlobalFilterMenu entry='toolbar' onClose={onClose} />;
}

const option = (databaseId: string, fieldId: string) =>
  screen
    .getAllByTestId('dashboard-global-filter-field-option')
    .find(
      (item) => item.getAttribute('data-database-id') === databaseId && item.getAttribute('data-field-id') === fieldId
    )!;

describe('Filter multiple sources', () => {
  it('intro → picker → builder; add another lists only same-type unmapped sources; Done opens the pill', () => {
    const onClose = jest.fn();

    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByTestId('dashboard-global-filter-multiple-sources'));
    const intro = screen.getByTestId('dashboard-global-filter-multi-intro');

    expect(intro.textContent).toContain('Create a filter that applies across properties from multiple sources');
    fireEvent.click(screen.getByTestId('dashboard-global-filter-add-to-filter'));
    // The multiple sources picker always groups, and has no footer.
    expect(screen.getByTestId('dashboard-global-filter-menu').getAttribute('data-screen')).toBe('multi-picker');
    expect(screen.queryByTestId('dashboard-global-filter-multiple-sources')).toBeNull();

    fireEvent.click(option('db-projects', 'p-status'));
    const builder = screen.getByTestId('dashboard-global-filter-builder');
    const filterId = builder.getAttribute('data-filter-id');

    expect(screen.getAllByTestId('dashboard-global-filter-target').map((row) => row.textContent)).toEqual([
      'StatusProjects',
    ]);
    expect(screen.getByTestId<HTMLInputElement>('dashboard-global-filter-name').placeholder).toBe('Status');

    fireEvent.click(screen.getByTestId('dashboard-global-filter-add-another'));
    // Single select properties of the sources not mapped yet: Tasks' Stage (Projects' Region is mapped through Projects).
    expect(
      screen.getAllByTestId('dashboard-global-filter-field-option').map((item) => item.getAttribute('data-field-id'))
    ).toEqual(['t-stage']);
    fireEvent.click(option('db-tasks', 't-stage'));
    expect(screen.getAllByTestId('dashboard-global-filter-target')).toHaveLength(2);

    fireEvent.click(screen.getByTestId('dashboard-global-filter-done'));
    expect(onClose).toHaveBeenCalled();
    expect(getPendingGlobalFilterEditor()).toBe(filterId);
  });

  it('Done is disabled with 0 targets', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('dashboard-global-filter-multiple-sources'));
    fireEvent.click(screen.getByTestId('dashboard-global-filter-add-to-filter'));
    fireEvent.click(option('db-notes', 'n-name'));
    fireEvent.click(screen.getByTestId('dashboard-global-filter-target-remove'));

    expect(screen.queryAllByTestId('dashboard-global-filter-target')).toHaveLength(0);
    expect(screen.getByTestId<HTMLButtonElement>('dashboard-global-filter-done').disabled).toBe(true);
  });
});
