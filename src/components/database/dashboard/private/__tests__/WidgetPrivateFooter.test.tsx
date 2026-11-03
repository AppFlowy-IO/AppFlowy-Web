import { fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';

import { createWidgetContextValue } from '../../__tests__/dashboardTestHarness';
import { WidgetContext } from '../../WidgetContext';
import { WidgetPrivateContext, WidgetPrivateHandle, WidgetPrivateSnapshot } from '../WidgetPrivateContext';
import { WidgetPrivateFooter } from '../WidgetPrivateFooter';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

function handleOf(snapshot: WidgetPrivateSnapshot): WidgetPrivateHandle {
  return { subscribe: () => () => undefined, getSnapshot: () => snapshot, reset: jest.fn(), save: jest.fn() };
}

function renderFooter(handle: WidgetPrivateHandle | null, wrap = true) {
  const getWidgetPrivateHandle = jest.fn(() => handle as WidgetPrivateHandle);
  const tree = (children: ReactNode) =>
    wrap ? (
      <WidgetContext.Provider value={createWidgetContextValue()}>
        <WidgetPrivateContext.Provider value={handle ? { getWidgetPrivateHandle } : null}>
          {children}
        </WidgetPrivateContext.Provider>
      </WidgetContext.Provider>
    ) : (
      children
    );

  return { ...render(tree(<WidgetPrivateFooter />)), getWidgetPrivateHandle };
}

describe('WidgetPrivateFooter', () => {
  it('hidden when clean', () => {
    const { container } = renderFooter(handleOf({ filters: false, sorts: false, canSave: true, suspended: false }));

    expect(container.innerHTML).toBe('');
  });

  it('hidden outside a dashboard and in Edit mode', () => {
    expect(renderFooter(null, false).container.innerHTML).toBe('');
    expect(
      renderFooter(handleOf({ filters: true, sorts: false, canSave: true, suspended: true })).container.innerHTML
    ).toBe('');
  });

  it('Reset only for a read-only source', () => {
    const handle = handleOf({ filters: false, sorts: true, canSave: false, suspended: false });

    renderFooter(handle);
    expect(screen.getByTestId('dashboard-widget-private-footer')).toBeTruthy();
    expect(screen.queryByTestId('dashboard-widget-save-for-everyone')).toBeNull();
    fireEvent.click(screen.getByTestId('dashboard-widget-private-reset'));
    expect(handle.reset).toHaveBeenCalledTimes(1);
  });

  it('Save calls saveForEveryone for this widget', () => {
    const handle = handleOf({ filters: true, sorts: false, canSave: true, suspended: false });
    const { getWidgetPrivateHandle } = renderFooter(handle);

    expect(getWidgetPrivateHandle).toHaveBeenCalledWith({ id: 'w1', databaseId: 'db', viewId: 'view-w1' });
    fireEvent.click(screen.getByTestId('dashboard-widget-save-for-everyone'));
    expect(handle.save).toHaveBeenCalledTimes(1);
  });
});
