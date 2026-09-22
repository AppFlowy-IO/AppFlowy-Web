import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';

import { DashboardGlobalFilter, DashboardLayoutUpdate, DashboardRow } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { SelectOptionFilterCondition } from '@/application/database-yjs/fields/select-option/select_option.type';
import { YDoc } from '@/application/types';
import type {
  DashboardContextValue,
  DashboardLayoutContextValue,
  DashboardFiltersContextValue,
  DashboardSourcesContextValue,
} from '@/components/database/dashboard/DashboardContext';

import { GlobalFilterMenu } from '../GlobalFilterMenu';

import { createSourceDoc, option } from './source-doc.fixture';

/** The four dashboard contexts, served from one object. */
type MockDashboard = DashboardContextValue &
  DashboardLayoutContextValue &
  DashboardFiltersContextValue &
  DashboardSourcesContextValue;

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
    useDashboardLocalWidgetChanges: () => ({ unsaved: 0, savable: 0 }),
  };
});

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUserOptional: () => undefined,
}));

jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => ({
  useMentionableUsersWithAutoFetch: () => ({ users: [], loading: false }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const count = options?.count;
      const template =
        (count === 1 ? options?.defaultValue_one : count !== undefined ? options?.defaultValue_other : undefined) ??
        options?.defaultValue ??
        key;

      return String(template).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
    },
  }),
}));

const todo = option('o-todo', 'Todo');
const done = option('o-done', 'Done');

const docs = {
  'db-host': createSourceDoc('db-host', [
    { id: 'host-name', name: 'Name', type: FieldType.RichText, isPrimary: true },
    { id: 'host-status', name: 'Status', type: FieldType.SingleSelect, options: [todo, done] },
    { id: 'host-extra', name: 'Extra', type: FieldType.RichText },
  ]),
  'db-other': createSourceDoc('db-other', [
    { id: 'other-title', name: 'Title', type: FieldType.RichText, isPrimary: true },
    { id: 'other-state', name: 'State', type: FieldType.SingleSelect, options: [todo, done] },
  ]),
  // Registered but not on the dashboard: never offered as a source.
  'db-unused': createSourceDoc('db-unused', [
    { id: 'unused-points', name: 'Points', type: FieldType.Number, isPrimary: true },
  ]),
} as Record<string, YDoc>;

const rows: DashboardRow[] = [
  {
    id: 'r:1',
    height: 360,
    widgets: [
      { id: 'w:1', viewId: 'view-host', databaseId: 'db-host', width: 6 },
      { id: 'w:2', viewId: 'view-other', databaseId: 'db-other', width: 6 },
    ],
  },
];

const statusFilter: DashboardGlobalFilter = {
  id: 'gf:status',
  name: 'Status',
  fieldType: FieldType.SingleSelect,
  condition: SelectOptionFilterCondition.OptionIs,
  content: '',
  targets: { 'db-host': 'host-status', 'db-other': 'other-state' },
};

interface HarnessProps {
  canEdit: boolean;
  isEditing: boolean;
  initial: DashboardGlobalFilter[];
  onPersist: jest.Mock;
  onLocal: jest.Mock;
  onClose?: () => void;
  filterId?: string;
}

/**
 * Keeps persisted and local filters in state so writes flow back into the
 * menu, and unmounts the menu when it asks to close (like its popover does).
 */
function Harness({ canEdit, isEditing, initial, onPersist, onLocal, onClose = jest.fn(), filterId }: HarnessProps) {
  const [persisted, setPersisted] = useState(initial);
  const [local, setLocal] = useState<DashboardGlobalFilter[] | null>(null);
  const [open, setOpen] = useState(true);

  mockContext = {
    dashboardViewId: 'dashboard-view',
    hostDatabaseId: 'db-host',
    hostViewIds: ['view-host', 'dashboard-view'],
    rows,
    showWidgetTitles: true,
    globalFilters: persisted,
    effectiveGlobalFilters: local ?? persisted,
    localGlobalFilters: local,
    setLocalGlobalFilters: (filters) => {
      onLocal(filters);
      setLocal(filters);
    },
    canEdit,
    isEditing,
    setEditing: jest.fn(),
    updateSetting: (update: DashboardLayoutUpdate) => {
      onPersist(update);
      if (update.globalFilters) setPersisted(update.globalFilters);
    },
    updateRows: jest.fn(),
    sourceDocs: docs,
    registerSourceDoc: jest.fn(),
    sourceNames: { 'db-host': 'Tasks', 'db-other': 'Projects' },
    registerSourceName: jest.fn(),
  };

  if (!open) {
    return (
      <button type='button' data-testid='reopen' onClick={() => setOpen(true)}>
        reopen
      </button>
    );
  }

  return (
    <GlobalFilterMenu
      filterId={filterId}
      onClose={() => {
        onClose();
        setOpen(false);
      }}
    />
  );
}

const lastCall = (mock: jest.Mock) => mock.mock.calls[mock.mock.calls.length - 1][0];

const targetRow = (databaseId: string) =>
  screen
    .queryAllByTestId('dashboard-global-filter-target')
    .find((target) => target.getAttribute('data-database-id') === databaseId);

function openDropdown(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
}

beforeAll(() => {
  // Radix menus open on a primary-button pointerdown, which jsdom cannot build.
  window.PointerEvent = MouseEvent as typeof PointerEvent;
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
  HTMLElement.prototype.scrollIntoView = () => undefined;
  global.ResizeObserver = class {
    observe() {
      return undefined;
    }

    unobserve() {
      return undefined;
    }

    disconnect() {
      return undefined;
    }
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  mockContext = null;
});

describe('GlobalFilterMenu', () => {
  it('adds a filter for a viewer as a local override', () => {
    const onPersist = jest.fn();
    const onLocal = jest.fn();

    render(<Harness canEdit={false} isEditing={false} initial={[]} onPersist={onPersist} onLocal={onLocal} />);

    expect(screen.getByTestId('dashboard-global-filter-menu').textContent).toContain('Filter multiple sources');
    expect(screen.getByTestId('dashboard-global-filter-menu-local-hint')).toBeTruthy();

    fireEvent.click(screen.getByTestId('dashboard-global-filter-add'));
    const options = screen.getAllByTestId('dashboard-global-filter-property-option');

    // Only the widget databases count: the unused database's Number property is not offered.
    expect(options.map((item) => item.getAttribute('data-field-type'))).toEqual([
      String(FieldType.RichText),
      String(FieldType.SingleSelect),
    ]);
    expect(options[0].textContent).toContain('2 sources');

    fireEvent.click(options[1]);

    const editor = screen.getByTestId('dashboard-global-filter-editor');
    const created = lastCall(onLocal)[0] as DashboardGlobalFilter;

    expect(created).toMatchObject({
      name: 'Status',
      fieldType: FieldType.SingleSelect,
      condition: SelectOptionFilterCondition.OptionIs,
      content: '',
      targets: { 'db-host': 'host-status', 'db-other': 'other-state' },
    });
    expect(editor.getAttribute('data-filter-id')).toBe(created.id);
    expect(screen.getByTestId<HTMLInputElement>('dashboard-global-filter-name').value).toBe('Status');
    expect(screen.getByTestId('dashboard-global-filter-condition').textContent).toBe('grid.selectOptionFilter.is');
    expect(editor.textContent).toContain('This filter will apply across grid.field.singleSelectFieldName properties');

    const targets = screen.getAllByTestId('dashboard-global-filter-target');

    expect(targets.map((target) => target.getAttribute('data-database-id'))).toEqual(['db-host', 'db-other']);
    expect(within(targets[0]).getByTestId('dashboard-global-filter-target-select').textContent).toBe('Status');

    const content = screen.getByTestId('dashboard-global-filter-content');
    const doneOption = within(content)
      .getAllByTestId('dashboard-global-filter-option')
      .find((item) => item.getAttribute('data-option-id') === 'o-done');

    fireEvent.click(doneOption!);
    expect((lastCall(onLocal)[0] as DashboardGlobalFilter).content).toBe('o-done');
    expect(onPersist).not.toHaveBeenCalled();

    // The back arrow returns to the list; Done closes the menu.
    fireEvent.click(screen.getByTestId('dashboard-global-filter-back'));
    expect(screen.getByTestId('dashboard-global-filter-item').textContent).toContain(
      'Status: grid.selectOptionFilter.is Done'
    );
    fireEvent.click(screen.getByTestId('dashboard-global-filter-item'));
    fireEvent.click(screen.getByTestId('dashboard-global-filter-done'));
    expect(screen.queryByTestId('dashboard-global-filter-menu')).toBeNull();
  });

  it('labels checkbox conditions with their verb', () => {
    const checkboxDocs = {
      'db-host': createSourceDoc('db-host', [{ id: 'host-urgent', name: 'Urgent', type: FieldType.Checkbox }]),
    } as Record<string, YDoc>;
    const onLocal = jest.fn();

    function CheckboxHarness() {
      const [local, setLocal] = useState<DashboardGlobalFilter[] | null>(null);

      mockContext = {
        dashboardViewId: 'dashboard-view',
        hostDatabaseId: 'db-host',
        hostViewIds: [],
        rows,
        showWidgetTitles: true,
        globalFilters: [],
        effectiveGlobalFilters: local ?? [],
        localGlobalFilters: local,
        setLocalGlobalFilters: (filters) => {
          onLocal(filters);
          setLocal(filters);
        },
        canEdit: false,
        isEditing: false,
        setEditing: jest.fn(),
        updateSetting: jest.fn(),
        updateRows: jest.fn(),
        sourceDocs: checkboxDocs,
        registerSourceDoc: jest.fn(),
        sourceNames: { 'db-host': 'Tasks' },
        registerSourceName: jest.fn(),
      };

      return <GlobalFilterMenu startWithPicker onClose={jest.fn()} />;
    }

    render(<CheckboxHarness />);
    fireEvent.click(screen.getByTestId('dashboard-global-filter-property-option'));

    expect(screen.getByTestId('dashboard-global-filter-condition').textContent).toBe('Is checked');
    expect(screen.queryByTestId('dashboard-global-filter-content')).toBeNull();
    expect(lastCall(onLocal)[0]).toMatchObject({ name: 'Urgent', targets: { 'db-host': 'host-urgent' } });
  });

  it('persists changes while a writer edits the dashboard', async () => {
    const onPersist = jest.fn();
    const onLocal = jest.fn();

    render(<Harness canEdit isEditing initial={[statusFilter]} onPersist={onPersist} onLocal={onLocal} />);

    expect(screen.queryByTestId('dashboard-global-filter-menu-local-hint')).toBeNull();
    fireEvent.click(screen.getByTestId('dashboard-global-filter-item'));
    expect(targetRow('db-other')!.getAttribute('data-field-id')).toBe('other-state');
    expect(screen.queryByTestId('dashboard-global-filter-add-source')).toBeNull();

    fireEvent.click(within(targetRow('db-other')!).getByTestId('dashboard-global-filter-target-remove'));
    expect(lastCall(onPersist)).toEqual({
      globalFilters: [{ ...statusFilter, targets: { 'db-host': 'host-status' } }],
    });

    // The unmapped source leaves the list and can be mapped again from "Add source".
    expect(targetRow('db-other')).toBeUndefined();
    openDropdown(screen.getByTestId('dashboard-global-filter-add-source'));
    const addOptions = await waitFor(() => screen.getAllByTestId('dashboard-global-filter-add-source-option'));

    expect(addOptions.map((item) => item.getAttribute('data-database-id'))).toEqual(['db-other']);
    expect(addOptions[0].textContent).toBe('Projects');
    fireEvent.click(addOptions[0]);
    expect(lastCall(onPersist)).toEqual({ globalFilters: [statusFilter] });
    expect(targetRow('db-other')!.getAttribute('data-field-id')).toBe('other-state');

    fireEvent.change(screen.getByTestId('dashboard-global-filter-name'), { target: { value: 'Stage' } });
    // The name edit is debounced in the app and flushed at the latest when the editor closes.
    fireEvent.click(screen.getByTestId('dashboard-global-filter-done'));
    expect(screen.queryByTestId('dashboard-global-filter-menu')).toBeNull();
    expect((lastCall(onPersist).globalFilters as DashboardGlobalFilter[])[0].name).toBe('Stage');
    expect(onLocal).not.toHaveBeenCalledWith(expect.any(Array));

    fireEvent.click(screen.getByTestId('reopen'));
    fireEvent.click(screen.getByTestId('dashboard-global-filter-item'));
    fireEvent.click(screen.getByTestId('dashboard-global-filter-delete'));
    expect(lastCall(onPersist)).toEqual({ globalFilters: [] });
    expect(screen.queryByTestId('dashboard-global-filter-item')).toBeNull();
    expect(screen.getByTestId('dashboard-global-filter-menu').getAttribute('data-screen')).toBe('list');
  });

  it('closes after editing a filter opened from its chip', () => {
    const onClose = jest.fn();

    render(
      <Harness
        canEdit
        isEditing={false}
        initial={[statusFilter]}
        onPersist={jest.fn()}
        onLocal={jest.fn()}
        onClose={onClose}
        filterId='gf:status'
      />
    );

    expect(screen.queryByTestId('dashboard-global-filter-back')).toBeNull();
    fireEvent.click(screen.getByTestId('dashboard-global-filter-done'));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes after deleting a filter opened from its chip', () => {
    const onClose = jest.fn();
    const onPersist = jest.fn();

    render(
      <Harness
        canEdit
        isEditing
        initial={[statusFilter]}
        onPersist={onPersist}
        onLocal={jest.fn()}
        onClose={onClose}
        filterId='gf:status'
      />
    );

    fireEvent.click(screen.getByTestId('dashboard-global-filter-delete'));
    expect(lastCall(onPersist)).toEqual({ globalFilters: [] });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('dashboard-global-filter-menu')).toBeNull();
  });

  it('keeps a mapping to a database that is not loaded removable', () => {
    const onPersist = jest.fn();
    const stale = { ...statusFilter, targets: { ...statusFilter.targets, 'db-gone': 'gone-status' } };

    render(
      <Harness canEdit isEditing initial={[stale]} onPersist={onPersist} onLocal={jest.fn()} filterId='gf:status' />
    );

    const row = targetRow('db-gone')!;

    expect(row.textContent).toContain('Untitled');
    expect(within(row).getByTestId<HTMLButtonElement>('dashboard-global-filter-target-select').disabled).toBe(true);
    fireEvent.click(within(row).getByTestId('dashboard-global-filter-target-remove'));
    expect(lastCall(onPersist)).toEqual({ globalFilters: [statusFilter] });
  });

  it('keeps a writer’s View-mode override private while editing other filters in Edit mode', () => {
    const onPersist = jest.fn();
    const onLocal = jest.fn();
    const nameFilter: DashboardGlobalFilter = {
      id: 'gf:name',
      name: 'Name',
      fieldType: FieldType.RichText,
      condition: 0,
      content: '',
      targets: { 'db-host': 'host-name' },
    };
    const item = (filterId: string) =>
      screen
        .getAllByTestId('dashboard-global-filter-item')
        .find((element) => element.getAttribute('data-filter-id') === filterId)!;
    const props = { canEdit: true, initial: [statusFilter, nameFilter], onPersist, onLocal };
    const { rerender } = render(<Harness {...props} isEditing={false} />);

    // View mode: a private selection.
    fireEvent.click(item('gf:status'));
    const todoOption = within(screen.getByTestId('dashboard-global-filter-content'))
      .getAllByTestId('dashboard-global-filter-option')
      .find((element) => element.getAttribute('data-option-id') === 'o-todo')!;

    fireEvent.click(todoOption);
    expect(onPersist).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('dashboard-global-filter-back'));

    // Edit mode: renaming another filter publishes only the rename.
    rerender(<Harness {...props} isEditing />);
    fireEvent.click(item('gf:name'));
    fireEvent.change(screen.getByTestId('dashboard-global-filter-name'), { target: { value: 'Title' } });
    fireEvent.click(screen.getByTestId('dashboard-global-filter-done'));

    expect(lastCall(onPersist)).toEqual({ globalFilters: [statusFilter, { ...nameFilter, name: 'Title' }] });
    expect(lastCall(onLocal)).toEqual([
      { ...statusFilter, content: 'o-todo' },
      { ...nameFilter, name: 'Title' },
    ]);

    // Changing the private filter itself in Edit mode still keeps the selection private.
    fireEvent.click(screen.getByTestId('reopen'));
    fireEvent.click(item('gf:status'));
    fireEvent.change(screen.getByTestId('dashboard-global-filter-name'), { target: { value: 'Stage' } });
    fireEvent.click(screen.getByTestId('dashboard-global-filter-done'));

    expect(lastCall(onPersist)).toEqual({
      globalFilters: [
        { ...statusFilter, name: 'Stage' },
        { ...nameFilter, name: 'Title' },
      ],
    });
    expect((lastCall(onLocal) as DashboardGlobalFilter[])[0]).toEqual({
      ...statusFilter,
      name: 'Stage',
      content: 'o-todo',
    });
  });

  it('drops a writer’s local override once it matches the saved filters again', () => {
    const onPersist = jest.fn();
    const onLocal = jest.fn();

    render(<Harness canEdit isEditing={false} initial={[statusFilter]} onPersist={onPersist} onLocal={onLocal} />);

    fireEvent.click(screen.getByTestId('dashboard-global-filter-item'));
    const content = screen.getByTestId('dashboard-global-filter-content');
    const todoOption = () =>
      within(content)
        .getAllByTestId('dashboard-global-filter-option')
        .find((item) => item.getAttribute('data-option-id') === 'o-todo')!;

    fireEvent.click(todoOption());
    expect((lastCall(onLocal)[0] as DashboardGlobalFilter).content).toBe('o-todo');
    fireEvent.click(todoOption());
    expect(lastCall(onLocal)).toBeNull();
    expect(onPersist).not.toHaveBeenCalled();
  });
});
