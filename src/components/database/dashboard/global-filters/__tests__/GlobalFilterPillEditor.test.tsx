import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { DateFilterCondition } from '@/application/database-yjs/fields/date/date.type';

import { readGlobalFilterSourceFields } from '../global-filter.source-fields';
import { GlobalFilterSource } from '../global-filter.utils';
import { GlobalFilterPillEditor, GlobalFilterPillEditorProps } from '../GlobalFilterPillEditor';

import { createTestDocs, installPointerEvents } from './global-filter-test-context';

jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => undefined }));
jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => ({
  useMentionableUsersWithAutoFetch: () => ({ users: [], loading: false }),
}));
jest.mock('react-i18next', () => {
  const { MOCK_TRANSLATE: translate } = jest.requireActual('./global-filter-test-context');

  return { useTranslation: () => ({ t: translate }) };
});

beforeAll(installPointerEvents);

const docs = createTestDocs();
const SOURCES: GlobalFilterSource[] = Object.entries(docs).map(([databaseId, doc]) => ({
  databaseId,
  name: databaseId,
  fields: readGlobalFilterSourceFields(doc),
}));

function filterOf(patch: Partial<DashboardGlobalFilter>): DashboardGlobalFilter {
  return {
    id: 'gf',
    name: 'Name',
    fieldType: FieldType.RichText,
    condition: 2,
    content: '',
    targets: { 'db-projects': 'p-name' },
    ...patch,
  };
}

function renderEditor(filter: DashboardGlobalFilter, props: Partial<GlobalFilterPillEditorProps> = {}) {
  const handlers = {
    onValueChange: jest.fn(),
    onSelectionChange: jest.fn(),
    onOpenBuilder: jest.fn(),
    onDelete: jest.fn(),
  };

  render(<GlobalFilterPillEditor canEditStructure filter={filter} sources={SOURCES} {...handlers} {...props} />);
  return handlers;
}

const flushFrames = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

describe('GlobalFilterPillEditor', () => {
  it('focuses the text value', () => {
    renderEditor(filterOf({}));
    expect(document.activeElement).toBe(screen.getByTestId('dashboard-global-filter-content'));
    // No footer: no Done, no Delete button.
    expect(screen.queryByTestId('dashboard-global-filter-done')).toBeNull();
  });

  it('focuses the option search of a select filter and writes ids with names', async () => {
    const handlers = renderEditor(
      filterOf({
        name: 'Status',
        fieldType: FieldType.SingleSelect,
        condition: 0,
        targets: { 'db-projects': 'p-status', 'db-tasks': 't-stage' },
      })
    );

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('dashboard-global-filter-option-search'))
    );
    fireEvent.click(screen.getAllByTestId('dashboard-global-filter-option')[1]);
    expect(handlers.onSelectionChange).toHaveBeenCalledWith({ content: 'o-done', optionNames: ['Done'] });
  });

  it('focuses the condition when there is no value control', async () => {
    renderEditor(
      filterOf({ name: 'Urgent', fieldType: FieldType.Checkbox, condition: 0, targets: { 'db-projects': 'p-urgent' } })
    );
    await flushFrames();
    expect(document.activeElement).toBe(screen.getByTestId('dashboard-global-filter-condition'));
    expect(screen.getByTestId('dashboard-global-filter-condition').textContent).toBe('is checked');
  });

  it('shows an absolute date inline, and the relative builder with its hint for 28', () => {
    const { unmount } = render(
      <GlobalFilterPillEditor
        canEditStructure
        filter={filterOf({
          name: 'Due',
          fieldType: FieldType.DateTime,
          condition: DateFilterCondition.DateStartsOn,
          targets: { 'db-projects': 'p-due' },
        })}
        sources={SOURCES}
        onValueChange={jest.fn()}
        onSelectionChange={jest.fn()}
        onOpenBuilder={jest.fn()}
        onDelete={jest.fn()}
      />
    );

    expect(screen.getByTestId('dashboard-global-filter-date-calendar')).toBeTruthy();
    expect(screen.getByTestId('dashboard-global-filter-date-side').textContent).toBe('Start date');
    unmount();

    const handlers = renderEditor(
      filterOf({
        name: 'Due',
        fieldType: FieldType.DateTime,
        condition: DateFilterCondition.DateStartsRelative,
        content: JSON.stringify({ relative_direction: 'past', relative_amount: 7, relative_unit: 'day' }),
        targets: { 'db-projects': 'p-due' },
      })
    );

    expect(document.activeElement).toBe(screen.getByTestId('dashboard-global-filter-relative-amount'));
    expect(screen.getByTestId('dashboard-global-filter-relative-hint').textContent).toBe(
      'Filter will update with the current date'
    );
    fireEvent.change(screen.getByTestId('dashboard-global-filter-relative-amount'), { target: { value: '3' } });
    const updater = handlers.onValueChange.mock.calls[handlers.onValueChange.mock.calls.length - 1][0];

    expect(JSON.parse(updater(filterOf({ fieldType: FieldType.DateTime })).content)).toEqual({
      relative_direction: 'past',
      relative_amount: 3,
      relative_unit: 'day',
    });
  });

  it('offers "Is relative to today" after "Is between" and switching writes This week', async () => {
    const handlers = renderEditor(
      filterOf({
        name: 'Due',
        fieldType: FieldType.DateTime,
        condition: DateFilterCondition.DateStartsOn,
        targets: { 'db-projects': 'p-due' },
      })
    );

    fireEvent.pointerDown(screen.getByTestId('dashboard-global-filter-condition'), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    });
    const options = await waitFor(() => screen.getAllByTestId('dashboard-global-filter-condition-option'));

    expect(options.slice(0, 9).map((item) => item.textContent)).toEqual([
      'grid.dateFilter.is',
      'grid.dateFilter.before',
      'grid.dateFilter.after',
      'grid.dateFilter.onOrBefore',
      'grid.dateFilter.onOrAfter',
      'grid.dateFilter.between',
      'Is relative to today',
      'grid.dateFilter.empty',
      'grid.dateFilter.notEmpty',
    ]);
    fireEvent.click(options[6]);
    const updater = handlers.onValueChange.mock.calls[0][0];
    const next = updater(filterOf({ fieldType: FieldType.DateTime, condition: DateFilterCondition.DateStartsOn }));

    expect(next.condition).toBe(DateFilterCondition.DateStartsRelative);
    expect(JSON.parse(next.content)).toEqual({ relative_direction: 'this', relative_amount: 1, relative_unit: 'week' });
  });

  it('hides the more actions from readers', () => {
    renderEditor(filterOf({}), { canEditStructure: false });
    expect(screen.queryByTestId('dashboard-global-filter-more-actions')).toBeNull();
  });

  it('deletes and opens the builder through the more actions', async () => {
    const handlers = renderEditor(filterOf({}));
    const more = screen.getByTestId('dashboard-global-filter-more-actions');

    expect(more.getAttribute('aria-label')).toBe('More actions');
    fireEvent.pointerDown(more, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await waitFor(() => screen.getByTestId('dashboard-global-filter-delete')));
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(more, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await waitFor(() => screen.getByTestId('dashboard-global-filter-open-builder')));
    expect(handlers.onOpenBuilder).toHaveBeenCalledTimes(1);
  });
});
