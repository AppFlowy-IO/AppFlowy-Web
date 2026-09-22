import { fireEvent, render, screen } from '@testing-library/react';

import { DatabaseViewLayout } from '@/application/types';

import { getWidgetStatus, WidgetStatusInput } from '../widget-status';
import { WidgetPlaceholder } from '../WidgetPlaceholder';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const READY: WidgetStatusInput = {
  noAccess: false,
  loadFailed: false,
  deletionStatus: 'none',
  databaseMissing: false,
  viewMissing: false,
  hasDoc: true,
  hasDatabase: true,
  viewExists: true,
  layout: DatabaseViewLayout.Grid,
};

describe('getWidgetStatus', () => {
  it('is ready once the view of a live database is loaded', () => {
    expect(getWidgetStatus(READY)).toBe('ready');
  });

  it('reports access problems before anything else', () => {
    expect(getWidgetStatus({ ...READY, noAccess: true, loadFailed: true, deletionStatus: 'deleted' })).toBe('no-access');
    expect(getWidgetStatus({ ...READY, noAccess: true, hasDoc: false })).toBe('no-access');
  });

  it.each([
    ['a failed load', { loadFailed: true, hasDoc: false }],
    ['a trashed database', { deletionStatus: 'inTrash' as const }],
    ['a deleted database', { deletionStatus: 'deleted' as const }],
    ['a doc that never got its database', { databaseMissing: true, hasDatabase: false }],
    ['a view that disappeared', { viewMissing: true, viewExists: false }],
  ])('reports %s as not found', (_name, overrides) => {
    expect(getWidgetStatus({ ...READY, ...overrides })).toBe('not-found');
  });

  it.each([
    ['the doc is loading', { hasDoc: false }],
    ['the database is syncing', { hasDatabase: false }],
    ['the view has not arrived yet', { viewExists: false }],
    ['the trash state is unknown', { deletionStatus: null }],
  ])('keeps loading while %s', (_name, overrides) => {
    expect(getWidgetStatus({ ...READY, ...overrides })).toBe('loading');
  });

  it('refuses to nest a dashboard', () => {
    expect(getWidgetStatus({ ...READY, layout: DatabaseViewLayout.Dashboard })).toBe('unsupported');
  });

  it('renders every other layout, including an unknown one', () => {
    expect(getWidgetStatus({ ...READY, layout: DatabaseViewLayout.Timeline })).toBe('ready');
    expect(getWidgetStatus({ ...READY, layout: null })).toBe('ready');
  });
});

describe('WidgetPlaceholder', () => {
  it.each([
    ['loading', 'Loading…'],
    ['not-found', 'This view no longer exists'],
    ['no-access', "You don't have access to this database"],
    ['unsupported', "A dashboard can't be shown inside a dashboard"],
  ] as const)('explains the %s state', (reason, text) => {
    render(<WidgetPlaceholder reason={reason} />);
    const placeholder = screen.getByTestId('dashboard-widget-placeholder');

    expect(placeholder.getAttribute('data-reason')).toBe(reason);
    expect(placeholder.textContent).toContain(text);
    expect(screen.queryByTestId('dashboard-widget-remove-button')).toBeNull();
  });

  it('marks the loading state as busy', () => {
    render(<WidgetPlaceholder reason='loading' />);
    const placeholder = screen.getByTestId('dashboard-widget-placeholder');

    expect(placeholder.getAttribute('aria-busy')).toBe('true');
    expect(placeholder.getAttribute('role')).toBe('status');
  });

  it('offers removal of a broken widget', () => {
    const onRemove = jest.fn();

    render(<WidgetPlaceholder onRemove={onRemove} reason='not-found' />);
    fireEvent.click(screen.getByTestId('dashboard-widget-remove-button'));

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('dashboard-widget-remove-button').textContent).toContain('Remove widget');
  });

  it('never offers removal while loading', () => {
    render(<WidgetPlaceholder onRemove={jest.fn()} reason='loading' />);

    expect(screen.queryByTestId('dashboard-widget-remove-button')).toBeNull();
  });
});
