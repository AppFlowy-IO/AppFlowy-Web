import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';

import {
  applyPrivateGlobalValues,
  globalFilterValueOf,
  PrivateGlobalValue,
  PrivateGlobalValues,
  sameGlobalFilterValue,
} from '@/application/database-yjs/dashboard-private';
import { DashboardGlobalFilter, DashboardLayoutUpdate, DashboardRow } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { SelectOptionFilterCondition } from '@/application/database-yjs/fields/select-option/select_option.type';
import { YDoc } from '@/application/types';
import type {
  DashboardContextValue,
  DashboardFiltersContextValue,
  DashboardLayoutContextValue,
  DashboardPrivateSummary,
  DashboardSourcesContextValue,
} from '@/components/database/dashboard/DashboardContext';

import {
  GlobalFilterMenu,
  GlobalFilterMenuEntry,
  GlobalFilterMenuScreen,
  GlobalFilterMenuVariant,
} from '../GlobalFilterMenu';
import { clearGlobalFilterEditorRequest, getPendingGlobalFilterEditor } from '../pendingEditorStore';

import { createSourceDoc, option } from './source-doc.fixture';

/** The dashboard contexts, served from one object. */
type MockDashboard = DashboardContextValue &
  DashboardLayoutContextValue &
  DashboardFiltersContextValue &
  DashboardSourcesContextValue & { summary: DashboardPrivateSummary };

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
    { id: 'host-urgent', name: 'Urgent', type: FieldType.Checkbox },
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

const nameFilter: DashboardGlobalFilter = {
  id: 'gf:name',
  name: 'Name',
  fieldType: FieldType.RichText,
  condition: 2,
  content: '',
  targets: { 'db-host': 'host-name' },
};

interface HarnessProps {
  canEdit: boolean;
  isEditing: boolean;
  initial: DashboardGlobalFilter[];
  onPersist: jest.Mock;
  onPrivate: jest.Mock;
  onClose?: () => void;
  entry?: GlobalFilterMenuEntry;
  filterId?: string;
  variant?: GlobalFilterMenuVariant;
  /** The popover holds the screen (both or neither). */
  screen?: GlobalFilterMenuScreen;
  onScreenChange?: (screen: GlobalFilterMenuScreen) => void;
  onSheetBackChange?: (onBack: (() => void) | null) => void;
}

/**
 * Keeps the saved filters and the private values in state, like the
 * provider (values only, applied in View mode), and unmounts the menu when
 * it asks to close (like its popover does).
 */
function Harness({
  canEdit,
  isEditing,
  initial,
  onPersist,
  onPrivate,
  onClose = jest.fn(),
  entry = 'toolbar',
  filterId,
  variant,
  screen: controlledScreen,
  onScreenChange,
  onSheetBackChange,
}: HarnessProps) {
  const [persisted, setPersisted] = useState(initial);
  const [values, setValues] = useState<PrivateGlobalValues>({});
  const [open, setOpen] = useState(true);
  const dirtyIds = new Set(isEditing ? [] : Object.keys(values));

  mockContext = {
    dashboardViewId: 'dashboard-view',
    hostDatabaseId: 'db-host',
    hostViewIds: ['view-host', 'dashboard-view'],
    rows,
    showWidgetTitles: true,
    showIconsInHeading: false,
    globalFilters: persisted,
    effectiveGlobalFilters: isEditing ? persisted : applyPrivateGlobalValues(persisted, values),
    privateGlobalValues: values,
    dirtyGlobalFilterIds: dirtyIds,
    setPrivateGlobalValue: (id: string, value: PrivateGlobalValue | null) => {
      const saved = persisted.find((filter) => filter.id === id);

      setValues((current) => {
        const next = { ...current };

        if (!value || !saved || sameGlobalFilterValue(saved.fieldType, value, globalFilterValueOf(saved)))
          delete next[id];
        else next[id] = value;
        onPrivate(next);
        return next;
      });
    },
    saveForEveryone: jest.fn(() => null),
    resetPrivateChanges: jest.fn(),
    getWidgetPrivateParts: jest.fn(),
    getViewOverlay: jest.fn(),
    setViewOverlayWritable: jest.fn(),
    resetViewOverlays: jest.fn(),
    commitViewOverlays: jest.fn(),
    canEdit,
    isEditing,
    setEditing: jest.fn(),
    mobileContext: false,
    canEnterEdit: canEdit,
    pinEditing: jest.fn(),
    updateSetting: (update: DashboardLayoutUpdate) => {
      onPersist(update);
      if (update.globalFilters) setPersisted(update.globalFilters);
    },
    updateRows: jest.fn(),
    sourceDocs: docs,
    registerSourceDoc: jest.fn(),
    sourceNames: { 'db-host': 'Tasks', 'db-other': 'Projects' },
    registerSourceName: jest.fn(),
    summary: {
      hasChanges: dirtyIds.size > 0,
      canSave: canEdit && dirtyIds.size > 0,
      dirtyGlobalCount: dirtyIds.size,
      dirtyWidgetCount: 0,
      savableWidgetCount: 0,
    },
  };

  if (!open) {
    return (
      <button type='button' data-testid='reopen' onClick={() => setOpen(true)}>
        reopen
      </button>
    );
  }

  return (
    <>
      <button type='button' data-testid='close-popover' onClick={() => setOpen(false)}>
        close
      </button>
      <GlobalFilterMenu
        entry={entry}
        filterId={filterId}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        onScreenChange={onScreenChange}
        onSheetBackChange={onSheetBackChange}
        screen={controlledScreen}
        variant={variant}
      />
    </>
  );
}

const lastCall = (mock: jest.Mock) => mock.mock.calls[mock.mock.calls.length - 1][0];

const targetRow = (databaseId: string) =>
  screen
    .queryAllByTestId('dashboard-global-filter-target')
    .find((target) => target.getAttribute('data-database-id') === databaseId);

const fieldOption = (databaseId: string, fieldId: string) =>
  screen
    .getAllByTestId('dashboard-global-filter-field-option')
    .find(
      (item) => item.getAttribute('data-database-id') === databaseId && item.getAttribute('data-field-id') === fieldId
    )!;

const optionRow = (optionId: string) =>
  within(screen.getByTestId('dashboard-global-filter-content'))
    .getAllByTestId('dashboard-global-filter-option')
    .find((item) => item.getAttribute('data-option-id') === optionId)!;

function openDropdown(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
}

async function chooseMoreAction(testId: string) {
  openDropdown(screen.getByTestId('dashboard-global-filter-more-actions'));
  fireEvent.click(await waitFor(() => screen.getByTestId(testId)));
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
  clearGlobalFilterEditorRequest();
});

describe('GlobalFilterMenu', () => {
  it('gives a reader the list of the dashboard filters, without search, footer or a way to add one', () => {
    const onPersist = jest.fn();
    const onClose = jest.fn();

    render(
      <Harness
        canEdit={false}
        isEditing={false}
        initial={[statusFilter, nameFilter]}
        onPersist={onPersist}
        onPrivate={jest.fn()}
        onClose={onClose}
      />
    );

    expect(screen.getByTestId('dashboard-global-filter-menu').getAttribute('data-screen')).toBe('reader-list');
    expect(screen.queryByTestId('dashboard-global-filter-search')).toBeNull();
    expect(screen.queryByTestId('dashboard-global-filter-multiple-sources')).toBeNull();
    expect(screen.queryByTestId('dashboard-global-filter-field-option')).toBeNull();
    const items = screen.getAllByTestId('dashboard-global-filter-reader-item');

    expect(items.map((item) => item.textContent)).toEqual(['Status', 'Name']);

    // A row opens that pill's editor.
    fireEvent.click(items[0]);
    expect(onClose).toHaveBeenCalled();
    expect(getPendingGlobalFilterEditor()).toBe('gf:status');
    expect(onPersist).not.toHaveBeenCalled();
  });

  it('a writer in View mode adds a filter for everyone; the value picked afterwards is private', () => {
    const onPersist = jest.fn();
    const onPrivate = jest.fn();
    const onClose = jest.fn();
    const { unmount } = render(
      <Harness canEdit isEditing={false} initial={[]} onPersist={onPersist} onPrivate={onPrivate} onClose={onClose} />
    );

    expect(screen.getByTestId('dashboard-global-filter-menu').getAttribute('data-screen')).toBe('picker');
    // Only the widget databases count: the unused database is not offered.
    expect(
      screen
        .getAllByTestId('dashboard-global-filter-source-group')
        .map((group) => group.getAttribute('data-database-id'))
    ).toEqual(['db-host', 'db-other']);

    fireEvent.click(fieldOption('db-host', 'host-status'));
    const created = (lastCall(onPersist).globalFilters as DashboardGlobalFilter[])[0];

    expect(created).toMatchObject({
      name: 'Status',
      fieldType: FieldType.SingleSelect,
      condition: SelectOptionFilterCondition.OptionIs,
      content: '',
      targets: { 'db-host': 'host-status' },
    });
    expect(onClose).toHaveBeenCalled();
    expect(getPendingGlobalFilterEditor()).toBe(created.id);
    unmount();

    // The new pill's editor: the selection is private.
    render(
      <Harness
        canEdit
        isEditing={false}
        initial={[created]}
        onPersist={onPersist}
        onPrivate={onPrivate}
        entry='pill'
        filterId={created.id}
      />
    );
    onPersist.mockClear();
    fireEvent.click(optionRow('o-done'));
    expect(lastCall(onPrivate)).toEqual({
      [created.id]: { condition: SelectOptionFilterCondition.OptionIs, content: 'o-done', option_names: ['Done'] },
    });
    expect(onPersist).not.toHaveBeenCalled();
  });

  it('labels checkbox conditions with their verb', async () => {
    const urgent: DashboardGlobalFilter = {
      ...nameFilter,
      id: 'gf:urgent',
      name: 'Urgent',
      fieldType: FieldType.Checkbox,
      condition: 0,
      targets: { 'db-host': 'host-urgent' },
    };

    render(
      <Harness
        canEdit={false}
        isEditing={false}
        initial={[urgent]}
        onPersist={jest.fn()}
        onPrivate={jest.fn()}
        entry='pill'
        filterId='gf:urgent'
      />
    );

    // Notion's lowercase trigger ("is checked ˅"), the verb in the list.
    expect(screen.getByTestId('dashboard-global-filter-condition').textContent).toBe('is checked');
    expect(screen.queryByTestId('dashboard-global-filter-content')).toBeNull();
    openDropdown(screen.getByTestId('dashboard-global-filter-condition'));
    const options = await waitFor(() => screen.getAllByTestId('dashboard-global-filter-condition-option'));

    expect(options.map((item) => item.textContent)).toEqual(['Is checked', 'Is unchecked']);
  });

  it('persists the picked property alone, and the builder edits its sources, while a writer edits the dashboard', async () => {
    const onPersist = jest.fn();
    const onPrivate = jest.fn();

    render(<Harness canEdit isEditing initial={[]} onPersist={onPersist} onPrivate={onPrivate} />);

    fireEvent.click(screen.getByTestId('dashboard-global-filter-multiple-sources'));
    fireEvent.click(screen.getByTestId('dashboard-global-filter-add-to-filter'));
    fireEvent.click(fieldOption('db-host', 'host-status'));
    const created = (lastCall(onPersist).globalFilters as DashboardGlobalFilter[])[0];

    expect(Object.keys(created.targets)).toEqual(['db-host']);
    expect(created.content).toBe('');
    expect(screen.getByTestId('dashboard-global-filter-builder').getAttribute('data-filter-id')).toBe(created.id);

    // Add another: only single-select properties of the sources not mapped yet.
    fireEvent.click(screen.getByTestId('dashboard-global-filter-add-another'));
    expect(
      screen.getAllByTestId('dashboard-global-filter-field-option').map((item) => item.getAttribute('data-field-id'))
    ).toEqual(['other-state']);
    fireEvent.click(fieldOption('db-other', 'other-state'));
    expect((lastCall(onPersist).globalFilters as DashboardGlobalFilter[])[0].targets).toEqual({
      'db-host': 'host-status',
      'db-other': 'other-state',
    });
    expect(screen.queryByTestId('dashboard-global-filter-add-another')).toBeNull();

    fireEvent.click(within(targetRow('db-other')!).getByTestId('dashboard-global-filter-target-remove'));
    expect((lastCall(onPersist).globalFilters as DashboardGlobalFilter[])[0].targets).toEqual({
      'db-host': 'host-status',
    });

    fireEvent.change(screen.getByTestId('dashboard-global-filter-name'), { target: { value: 'Stage' } });
    // Done opens the pill's editor; the debounced name flushes on the way.
    fireEvent.click(screen.getByTestId('dashboard-global-filter-done'));
    expect((lastCall(onPersist).globalFilters as DashboardGlobalFilter[])[0].name).toBe('Stage');
    expect(getPendingGlobalFilterEditor()).toBe(created.id);
    expect(onPrivate).not.toHaveBeenCalled();
  });

  it('focuses the value and keeps what was typed when the popover closes (no Done button)', () => {
    const onPrivate = jest.fn();

    render(
      <Harness
        canEdit
        isEditing={false}
        initial={[nameFilter]}
        onPersist={jest.fn()}
        onPrivate={onPrivate}
        entry='pill'
        filterId='gf:name'
      />
    );

    const input = screen.getByTestId<HTMLInputElement>('dashboard-global-filter-content');

    expect(document.activeElement).toBe(input);
    expect(screen.queryByTestId('dashboard-global-filter-done')).toBeNull();
    // Debounced in the app (immediate under the test's debounce mock), flushed on unmount.
    fireEvent.change(input, { target: { value: 'launch' } });
    fireEvent.click(screen.getByTestId('close-popover'));
    expect(screen.queryByTestId('dashboard-global-filter-menu')).toBeNull();
    expect(lastCall(onPrivate)).toEqual({ 'gf:name': { condition: 2, content: 'launch' } });
  });

  it('closes after deleting a filter opened from its chip', async () => {
    const onClose = jest.fn();
    const onPersist = jest.fn();

    render(
      <Harness
        canEdit
        isEditing
        initial={[statusFilter]}
        onPersist={onPersist}
        onPrivate={jest.fn()}
        onClose={onClose}
        entry='pill'
        filterId='gf:status'
      />
    );

    await chooseMoreAction('dashboard-global-filter-delete');
    expect(lastCall(onPersist)).toEqual({ globalFilters: [] });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('dashboard-global-filter-menu')).toBeNull();
  });

  it('keeps a mapping to a database that is not loaded removable', async () => {
    const onPersist = jest.fn();
    const stale = { ...statusFilter, targets: { ...statusFilter.targets, 'db-gone': 'gone-status' } };

    render(
      <Harness
        canEdit
        isEditing
        initial={[stale]}
        onPersist={onPersist}
        onPrivate={jest.fn()}
        entry='pill'
        filterId='gf:status'
      />
    );

    await chooseMoreAction('dashboard-global-filter-open-builder');
    const row = targetRow('db-gone')!;

    expect(row.textContent).toContain('Untitled');
    fireEvent.click(within(row).getByTestId('dashboard-global-filter-target-remove'));
    expect(lastCall(onPersist)).toEqual({ globalFilters: [statusFilter] });
    // Back to the pill.
    fireEvent.click(screen.getByTestId('dashboard-global-filter-back'));
    expect(screen.getByTestId('dashboard-global-filter-menu').getAttribute('data-screen')).toBe('pill');
  });

  it('readers get no more actions', () => {
    render(
      <Harness
        canEdit={false}
        isEditing={false}
        initial={[statusFilter]}
        onPersist={jest.fn()}
        onPrivate={jest.fn()}
        entry='pill'
        filterId='gf:status'
      />
    );

    expect(screen.queryByTestId('dashboard-global-filter-more-actions')).toBeNull();
  });

  it('Edit mode shows saved values, renames persist, and the private value reappears after Done', async () => {
    const onPersist = jest.fn();
    const onPrivate = jest.fn();
    const props = {
      canEdit: true,
      initial: [statusFilter],
      onPersist,
      onPrivate,
      entry: 'pill' as const,
      filterId: 'gf:status',
    };
    const { rerender } = render(<Harness {...props} isEditing={false} />);

    // View mode: a private selection.
    fireEvent.click(optionRow('o-todo'));
    expect(onPersist).not.toHaveBeenCalled();
    expect(optionRow('o-todo').getAttribute('data-checked')).toBe('true');

    // Edit mode: the saved value shows, and a rename is written for everyone.
    rerender(<Harness {...props} isEditing />);
    expect(optionRow('o-todo').getAttribute('data-checked')).toBe('false');
    await chooseMoreAction('dashboard-global-filter-open-builder');
    fireEvent.change(screen.getByTestId('dashboard-global-filter-name'), { target: { value: 'Stage' } });
    fireEvent.click(screen.getByTestId('dashboard-global-filter-back'));
    expect(lastCall(onPersist)).toEqual({ globalFilters: [{ ...statusFilter, name: 'Stage' }] });

    // Done: the private selection is back.
    rerender(<Harness {...props} isEditing={false} />);
    expect(optionRow('o-todo').getAttribute('data-checked')).toBe('true');
    expect(Object.keys(lastCall(onPrivate))).toEqual(['gf:status']);
  });

  it("drops a writer's private value once it matches the saved filters again", () => {
    const onPersist = jest.fn();
    const onPrivate = jest.fn();

    render(
      <Harness
        canEdit
        isEditing={false}
        initial={[statusFilter]}
        onPersist={onPersist}
        onPrivate={onPrivate}
        entry='pill'
        filterId='gf:status'
      />
    );

    fireEvent.click(optionRow('o-todo'));
    expect(lastCall(onPrivate)['gf:status']).toMatchObject({ content: 'o-todo' });
    fireEvent.click(optionRow('o-todo'));
    expect(lastCall(onPrivate)).toEqual({});
    expect(onPersist).not.toHaveBeenCalled();
  });

  it('a pick of a property that already has its own filter reopens that filter', () => {
    const onPersist = jest.fn();
    const single = { ...statusFilter, targets: { 'db-host': 'host-status' } };

    render(<Harness canEdit isEditing initial={[single]} onPersist={onPersist} onPrivate={jest.fn()} />);
    act(() => {
      fireEvent.click(fieldOption('db-host', 'host-status'));
    });
    expect(onPersist).not.toHaveBeenCalled();
    expect(getPendingGlobalFilterEditor()).toBe('gf:status');
  });

  it('draws the screen its popover holds and reports pushes to it, without a sheet-back effect', () => {
    const onScreenChange = jest.fn();
    const onSheetBackChange = jest.fn();
    const controlled = (current: GlobalFilterMenuScreen) => (
      <Harness
        canEdit
        initial={[statusFilter]}
        isEditing={false}
        onPersist={jest.fn()}
        onPrivate={jest.fn()}
        onScreenChange={onScreenChange}
        onSheetBackChange={onSheetBackChange}
        screen={current}
        variant='sheet'
      />
    );
    const menu = () => screen.getByTestId('dashboard-global-filter-menu');
    const { rerender } = render(controlled({ type: 'picker' }));

    expect(menu().getAttribute('data-screen')).toBe('picker');
    fireEvent.click(screen.getByTestId('dashboard-global-filter-multiple-sources'));
    // The push is reported, not applied: the popover owns the screen.
    expect(onScreenChange).toHaveBeenCalledWith({ type: 'multi-intro' });
    expect(menu().getAttribute('data-screen')).toBe('picker');

    rerender(controlled({ type: 'multi-intro' }));
    expect(menu().getAttribute('data-screen')).toBe('multi-intro');
    fireEvent.click(screen.getByTestId('dashboard-global-filter-add-to-filter'));
    expect(onScreenChange).toHaveBeenLastCalledWith({ type: 'multi-picker' });
    // The sheet's header reads its back chevron from the screen it holds.
    expect(onSheetBackChange).not.toHaveBeenCalled();
  });
});
