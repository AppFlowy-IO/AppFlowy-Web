import { fireEvent, render, screen, within } from '@testing-library/react';

import { GlobalFilterMenu } from '../GlobalFilterMenu';
import { GlobalFilterPicker } from '../GlobalFilterPicker';

import { createTestContext, installPointerEvents, MockDashboard, rowsOf } from './global-filter-test-context';

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

const fieldIds = () =>
  screen.getAllByTestId('dashboard-global-filter-field-option').map((item) => item.getAttribute('data-field-id'));

describe('GlobalFilterPicker', () => {
  it('focuses the search box and groups properties by source with view counts', () => {
    mockContext = createTestContext();
    render(<GlobalFilterPicker mode='toolbar' onPick={jest.fn()} onMultipleSources={jest.fn()} />);

    const search = screen.getByTestId('dashboard-global-filter-search');

    expect(document.activeElement).toBe(search);
    expect(search.getAttribute('placeholder')).toBe('Filter by…');
    const groups = screen.getAllByTestId('dashboard-global-filter-source-group');

    expect(groups.map((group) => group.textContent)).toEqual(['Projects1 view', 'Tasks1 view', 'Notes1 view']);
    expect(groups[0].getAttribute('data-view-count')).toBe('1');
    // Five per source, then a more row.
    expect(fieldIds()).toEqual(['p-name', 'p-status', 'p-estimate', 'p-due', 'p-urgent', 't-name', 't-stage', 'n-name']);
  });

  it('the more row expands its group', () => {
    mockContext = createTestContext();
    render(<GlobalFilterPicker mode='toolbar' onPick={jest.fn()} />);

    const more = screen.getByTestId('dashboard-global-filter-more');

    expect(more.getAttribute('data-count')).toBe('1');
    expect(more.textContent).toBe('1 more');
    fireEvent.click(more);
    expect(fieldIds()).toContain('p-region');
    expect(screen.queryByTestId('dashboard-global-filter-more')).toBeNull();
  });

  it('moves the highlight with the arrow keys and picks with Enter', () => {
    const onPick = jest.fn();

    mockContext = createTestContext();
    render(<GlobalFilterPicker mode='toolbar' onPick={onPick} />);
    const search = screen.getByTestId('dashboard-global-filter-search');

    expect(screen.getAllByTestId('dashboard-global-filter-field-option')[0].getAttribute('data-active')).toBe('true');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'ArrowUp' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('db-projects', expect.objectContaining({ id: 'p-status' }));
  });

  it('searches without case or accents and says when nothing matches', () => {
    mockContext = createTestContext();
    render(<GlobalFilterPicker mode='toolbar' onPick={jest.fn()} />);
    const search = screen.getByTestId('dashboard-global-filter-search');

    fireEvent.change(search, { target: { value: 'ÉSTI' } });
    expect(fieldIds()).toEqual(['p-estimate']);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByTestId('dashboard-global-filter-no-results').textContent).toBe('No results');
  });

  it('no footer with one source, footer with 2+', () => {
    const onMultipleSources = jest.fn();

    mockContext = createTestContext({ rows: rowsOf('db-projects') });
    const { unmount } = render(
      <GlobalFilterPicker mode='toolbar' onPick={jest.fn()} onMultipleSources={onMultipleSources} />
    );

    // One source: a flat list of 8 without group headers.
    expect(screen.queryByTestId('dashboard-global-filter-source-group')).toBeNull();
    expect(fieldIds()).toHaveLength(6);
    expect(screen.queryByTestId('dashboard-global-filter-multiple-sources')).toBeNull();
    unmount();

    mockContext = createTestContext();
    render(<GlobalFilterPicker mode='toolbar' onPick={jest.fn()} onMultipleSources={onMultipleSources} />);
    fireEvent.click(screen.getByTestId('dashboard-global-filter-multiple-sources'));
    expect(onMultipleSources).toHaveBeenCalledTimes(1);
  });

  it('readers get the reader list', () => {
    mockContext = createTestContext({
      canEdit: false,
      isEditing: false,
      globalFilters: [
        { id: 'gf:a', name: 'Due', fieldType: 2, condition: 0, content: '', targets: { 'db-projects': 'p-due' } },
      ],
    });
    render(<GlobalFilterMenu entry='toolbar' onClose={jest.fn()} />);

    const menu = screen.getByTestId('dashboard-global-filter-menu');

    expect(menu.getAttribute('data-screen')).toBe('reader-list');
    expect(within(menu).queryByTestId('dashboard-global-filter-search')).toBeNull();
    expect(within(menu).getByTestId('dashboard-global-filter-reader-item').textContent).toBe('Due');
  });
});
