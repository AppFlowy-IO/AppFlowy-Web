/**
 * The detached filter store (the chart row popup's rules): while one is
 * provided, the filter dispatch hooks, and so every chip editor built on them,
 * write to the store. The view's Yjs filters must never change.
 */
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { ReactNode, useMemo, useState } from 'react';
import * as Y from 'yjs';

import { FieldType, FilterType } from '@/application/database-yjs/database.type';
import { TextFilter, TextFilterCondition } from '@/application/database-yjs/fields';
import {
  YDatabase,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseView,
  YjsDatabaseKey as K,
  YSharedRoot,
} from '@/application/types';
import TextFilterMenu from '@/components/database/components/filters/filter-menu/TextFilterMenu';

let mockDatabase: YDatabase;
let mockView: YDatabaseView;
let mockFields: YDatabaseFields;
let mockSharedRoot: YSharedRoot;

jest.mock('@/application/database-yjs/context', () => ({
  ...jest.requireActual('@/application/database-yjs/context'),
  useDatabase: () => mockDatabase,
  useDatabaseView: () => mockView,
  useDatabaseFields: () => mockFields,
  useSharedRoot: () => mockSharedRoot,
  useReadOnly: () => false,
  useConditionsReadOnly: () => false,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import {
  asYDatabaseFilters,
  createDetachedFilter,
  DetachedFilter,
  DetachedFilterStore,
  DetachedFilterStoreContext,
  isDetachedFilterCurrent,
  parseDetachedFilter,
  updateDetachedFilters,
} from '../detached-filters';
import { useAddFilter, useEnterAdvancedMode, useRemoveFilter, useUpdateFilter } from '../sort-filter';

function setup() {
  const doc = new Y.Doc();

  mockSharedRoot = doc.getMap('root') as YSharedRoot;
  mockDatabase = doc.getMap('database') as YDatabase;
  mockFields = new Y.Map() as YDatabaseFields;
  mockDatabase.set(K.fields, mockFields);
  const views = new Y.Map();

  mockDatabase.set(K.views, views as never);
  mockView = new Y.Map() as YDatabaseView;
  views.set('view', mockView);

  const name = new Y.Map() as YDatabaseField;

  mockFields.set('name', name);
  name.set(K.id, 'name');
  name.set(K.name, 'Name');
  name.set(K.type, FieldType.RichText);

  const filters = new Y.Array() as YDatabaseFilters;

  mockView.set(K.filters, filters);
  const viewRule = new Y.Map() as YDatabaseFilter;

  filters.push([viewRule]);
  viewRule.set(K.id, 'view-rule');
  viewRule.set(K.field_id, 'name');
  viewRule.set(K.type, FieldType.RichText);
  viewRule.set(K.filter_type, FilterType.Data);
  viewRule.set(K.condition, TextFilterCondition.TextContains);
  viewRule.set(K.content, 'kept');

  return { doc, filters };
}

describe('detached filter dispatch', () => {
  it('sends every filter write to the store and leaves the view untouched', () => {
    const { doc, filters } = setup();
    const before = Y.encodeStateVector(doc);
    const store: DetachedFilterStore = {
      addFilter: jest.fn(() => 'popup-rule'),
      updateFilter: jest.fn(),
      removeFilter: jest.fn(),
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DetachedFilterStoreContext.Provider value={store}>{children}</DetachedFilterStoreContext.Provider>
    );
    const { result } = renderHook(
      () => ({
        add: useAddFilter(),
        update: useUpdateFilter(),
        remove: useRemoveFilter(),
        enterAdvancedMode: useEnterAdvancedMode(),
      }),
      { wrapper }
    );

    act(() => {
      expect(result.current.add('name')).toBe('popup-rule');
      // Even an id the view also uses only reaches the store.
      result.current.update({ filterId: 'view-rule', fieldId: 'name', content: 'changed' });
      result.current.remove('view-rule');
      result.current.enterAdvancedMode(FilterType.And);
    });

    expect(store.addFilter).toHaveBeenCalledWith('name');
    expect(store.updateFilter).toHaveBeenCalledWith({ filterId: 'view-rule', fieldId: 'name', content: 'changed' });
    expect(store.removeFilter).toHaveBeenCalledWith('view-rule');
    expect(Y.encodeStateVector(doc)).toEqual(before);
    expect(filters.toJSON()).toEqual([expect.objectContaining({ id: 'view-rule', content: 'kept' })]);
  });

  it('still writes to the view without a store', () => {
    const { filters } = setup();
    const { result } = renderHook(() => ({ update: useUpdateFilter(), remove: useRemoveFilter() }));

    act(() => result.current.update({ filterId: 'view-rule', fieldId: 'name', content: 'changed' }));
    expect(filters.toJSON()).toEqual([expect.objectContaining({ id: 'view-rule', content: 'changed' })]);

    act(() => result.current.remove('view-rule'));
    expect(filters.length).toBe(0);
  });
});

function PopupHarness({ onRules }: { onRules: (rules: DetachedFilter[]) => void }) {
  const [rules, setRules] = useState<DetachedFilter[]>(() => [createDetachedFilter('name', mockFields, 'popup-rule')!]);
  const store = useMemo<DetachedFilterStore>(
    () => ({
      addFilter: () => undefined,
      updateFilter: (params) =>
        setRules((previous) => {
          const next = updateDetachedFilters(previous, mockFields, params);

          onRules(next);
          return next;
        }),
      removeFilter: (filterId) =>
        setRules((previous) => {
          const next = previous.filter((rule) => rule[K.id] !== filterId);

          onRules(next);
          return next;
        }),
    }),
    [onRules]
  );
  const filter = rules[0] && parseDetachedFilter(rules[0], mockFields);

  return (
    <DetachedFilterStoreContext.Provider value={store}>
      {filter ? <TextFilterMenu filter={filter as TextFilter} /> : <p>no rules</p>}
    </DetachedFilterStoreContext.Provider>
  );
}

describe('filter editors under a detached store', () => {
  beforeAll(() => {
    window.PointerEvent = MouseEvent as typeof PointerEvent;
    HTMLElement.prototype.hasPointerCapture = () => false;
    HTMLElement.prototype.setPointerCapture = () => undefined;
    HTMLElement.prototype.releasePointerCapture = () => undefined;
    HTMLElement.prototype.scrollIntoView = () => undefined;
  });

  it('edits and deletes a popup rule without touching the view, and offers no advanced mode', async () => {
    const { doc, filters } = setup();
    const before = Y.encodeStateVector(doc);
    const onRules = jest.fn();

    render(<PopupHarness onRules={onRules} />);

    fireEvent.change(screen.getByTestId('text-filter-input'), { target: { value: 'needle' } });
    // `lodash-es` is mocked with an immediate debounce in tests.
    await waitFor(() =>
      expect(onRules).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'popup-rule', content: 'needle' })])
    );

    fireEvent.pointerDown(screen.getByTestId('filter-more-options-button'), { button: 0, ctrlKey: false });
    await waitFor(() => expect(screen.getByTestId('delete-filter-button')).toBeTruthy());
    // Detached rules stay a flat AND list.
    expect(screen.queryByText('grid.filter.switchToAdvancedFilter')).toBeNull();
    fireEvent.click(screen.getByTestId('delete-filter-button'));

    await waitFor(() => expect(screen.getByText('no rules')).toBeTruthy());
    expect(onRules).toHaveBeenLastCalledWith([]);
    expect(Y.encodeStateVector(doc)).toEqual(before);
    expect(filters.toJSON()).toEqual([expect.objectContaining({ id: 'view-rule', content: 'kept' })]);
  });
});

describe('detached filter helpers', () => {
  it('creates the rule useAddFilter would store and parses it like a view rule', () => {
    setup();
    const rule = createDetachedFilter('name', mockFields, 'r1')!;

    expect(rule).toEqual({
      [K.id]: 'r1',
      [K.field_id]: 'name',
      [K.type]: FieldType.RichText,
      [K.filter_type]: FilterType.Data,
      [K.condition]: TextFilterCondition.TextContains,
      [K.content]: '',
    });
    expect(parseDetachedFilter(rule, mockFields)).toEqual(
      expect.objectContaining({ id: 'r1', fieldId: 'name', condition: TextFilterCondition.TextContains, content: '' })
    );
    expect(createDetachedFilter('missing', mockFields)).toBeNull();
  });

  it('patches with the view update rules and leaves the input list alone', () => {
    setup();
    const rules = [createDetachedFilter('name', mockFields, 'r1')!, createDetachedFilter('name', mockFields, 'r2')!];
    const next = updateDetachedFilters(rules, mockFields, {
      filterId: 'r2',
      condition: TextFilterCondition.TextIs,
      content: 'x',
    });

    expect(next.map((rule) => [rule[K.id], rule[K.condition], rule[K.content]])).toEqual([
      ['r1', TextFilterCondition.TextContains, ''],
      ['r2', TextFilterCondition.TextIs, 'x'],
    ]);
    expect(rules[1][K.content]).toBe('');
    // A patch naming another field is ignored, like on the view.
    expect(updateDetachedFilters(next, mockFields, { filterId: 'r1', fieldId: 'other', content: 'y' })[0][K.content]).toBe(
      ''
    );
  });

  it('drops rules whose field was deleted or changed type, and reads like a Y.Array', () => {
    setup();
    const rule = createDetachedFilter('name', mockFields, 'r1')!;

    expect(isDetachedFilterCurrent(rule, mockFields)).toBe(true);
    mockFields.get('name').set(K.type, FieldType.Number);
    expect(isDetachedFilterCurrent(rule, mockFields)).toBe(false);
    mockFields.delete('name');
    expect(isDetachedFilterCurrent(rule, mockFields)).toBe(false);

    const array = asYDatabaseFilters([rule]);

    expect(array.length).toBe(1);
    expect(array.toArray()).toEqual([rule]);
  });
});
