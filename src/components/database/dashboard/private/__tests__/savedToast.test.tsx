import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReactElement } from 'react';

import { SAVED_TOAST_DURATION_MS, SAVED_TOAST_ID, showSavedForEveryoneToast } from '../savedToast';

jest.mock('sonner', () => ({ toast: { custom: jest.fn(), dismiss: jest.fn() } }));

const mockToast = (jest.requireMock('sonner') as { toast: { custom: jest.Mock; dismiss: jest.Mock } }).toast;
const t = (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key);

interface FakeHistory {
  latest: object | null;
  subscribe: jest.Mock<() => void, [() => void]>;
  latestUndoGroup: jest.Mock<object | null, []>;
  undoIfLatest: jest.Mock<boolean, [object]>;
  push: (group: object | null) => void;
  listeners: Set<() => void>;
}

/** A dashboard history with one listener slot and a settable latest group. */
function history(latest: object | null): FakeHistory {
  const listeners = new Set<() => void>();
  const manager: FakeHistory = {
    latest,
    subscribe: jest.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    latestUndoGroup: jest.fn(() => manager.latest),
    undoIfLatest: jest.fn((group: object) => group === manager.latest),
    push(group: object | null) {
      manager.latest = group;
      listeners.forEach((listener) => listener());
    },
    listeners,
  };

  return manager;
}

function renderToast() {
  const [renderFn] = mockToast.custom.mock.calls[mockToast.custom.mock.calls.length - 1] as [() => ReactElement];

  return render(renderFn());
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the "Changes saved for everyone." toast', () => {
  it('shows the message and Undo; Undo calls undoIfLatest and closes', () => {
    const group = {};
    const manager = history(group);

    showSavedForEveryoneToast({ t, historyManager: manager, group });
    renderToast();
    const toast = screen.getByTestId('dashboard-saved-toast');

    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.getAttribute('data-parity-id')).toBe('dash-saved-toast');
    expect(toast.className).toContain('bg-dash-toast-bg');
    expect(toast.textContent).toContain('Changes saved for everyone.');
    fireEvent.click(screen.getByTestId('dashboard-saved-toast-undo'));
    expect(manager.undoIfLatest).toHaveBeenCalledWith(group);
    expect(mockToast.dismiss).toHaveBeenCalledWith(SAVED_TOAST_ID);
    expect(manager.listeners.size).toBe(0);
  });

  it('closes when a newer undo entry arrives', () => {
    const group = {};
    const manager = history(group);

    showSavedForEveryoneToast({ t, historyManager: manager, group });
    act(() => manager.push({}));
    expect(mockToast.dismiss).toHaveBeenCalledWith(SAVED_TOAST_ID);
    expect(manager.listeners.size).toBe(0);
  });

  it('lasts 5s, one at a time, and closes on Escape', () => {
    const first = history({});

    showSavedForEveryoneToast({ t, historyManager: first, group: first.latest as object });
    expect(mockToast.custom).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ id: SAVED_TOAST_ID, duration: SAVED_TOAST_DURATION_MS })
    );
    expect(SAVED_TOAST_DURATION_MS).toBe(5000);
    // A new save replaces the toast and its subscription.
    const second = history({});

    showSavedForEveryoneToast({ t, historyManager: second, group: second.latest as object });
    expect(first.listeners.size).toBe(0);
    renderToast();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockToast.dismiss).toHaveBeenCalledWith(SAVED_TOAST_ID);
  });
});
