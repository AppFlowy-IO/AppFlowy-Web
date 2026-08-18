import { act, renderHook } from '@testing-library/react';

import { useDatabaseHistory } from '@/application/database-yjs';
import { useDatabaseRowHistoryHotkeys } from '@/components/database/hooks/useDatabaseRowHistoryHotkeys';

jest.mock('@/application/database-yjs', () => ({
  useDatabaseHistory: jest.fn(),
}));

const mockUseDatabaseHistory = jest.mocked(useDatabaseHistory);

function dispatchHistory(target: EventTarget, redoHistory = false): KeyboardEvent {
  const modifier = /Mac|iPod|iPhone|iPad/.test(window.navigator.platform) ? { metaKey: true } : { ctrlKey: true };
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'z',
    shiftKey: redoHistory,
    ...modifier,
  });

  Object.defineProperty(event, 'which', { value: 90 });

  act(() => {
    target.dispatchEvent(event);
  });

  return event;
}

function dispatchUndo(target: EventTarget): KeyboardEvent {
  return dispatchHistory(target);
}

function dispatchRedo(target: EventTarget): KeyboardEvent {
  return dispatchHistory(target, true);
}

describe('useDatabaseRowHistoryHotkeys', () => {
  const undo = jest.fn();
  const redo = jest.fn();

  beforeEach(() => {
    mockUseDatabaseHistory.mockReturnValue({
      canRedo: true,
      canUndo: true,
      redo,
      undo,
    } as ReturnType<typeof useDatabaseHistory>);
  });

  afterEach(() => {
    document.body.replaceChildren();
    jest.clearAllMocks();
  });

  it('uses database history for a non-editable grid target', () => {
    const target = document.createElement('div');

    target.tabIndex = 0;
    document.body.append(target);
    target.focus();

    renderHook(() =>
      useDatabaseRowHistoryHotkeys(undefined, {
        ignoreInput: true,
        useLatest: true,
      })
    );

    const event = dispatchUndo(target);

    expect(undo).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
    ['select', () => document.createElement('select')],
  ])('leaves undo to an active %s', (_name, createElement) => {
    const target = createElement();

    document.body.append(target);
    target.focus();

    renderHook(() =>
      useDatabaseRowHistoryHotkeys(undefined, {
        ignoreInput: true,
        useLatest: true,
      })
    );

    const event = dispatchUndo(target);

    expect(undo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('applies the same ownership rules to redo', () => {
    const gridTarget = document.createElement('div');
    const editor = document.createElement('textarea');

    document.body.append(gridTarget, editor);

    renderHook(() =>
      useDatabaseRowHistoryHotkeys(undefined, {
        ignoreInput: true,
        useLatest: true,
      })
    );

    const databaseEvent = dispatchRedo(gridTarget);
    const nativeEvent = dispatchRedo(editor);

    expect(redo).toHaveBeenCalledTimes(1);
    expect(databaseEvent.defaultPrevented).toBe(true);
    expect(nativeEvent.defaultPrevented).toBe(false);
  });

  it('leaves undo to a descendant of a contenteditable element', () => {
    const editor = document.createElement('div');
    const target = document.createElement('span');

    editor.setAttribute('contenteditable', 'true');
    editor.append(target);
    document.body.append(editor);

    renderHook(() =>
      useDatabaseRowHistoryHotkeys(undefined, {
        ignoreInput: true,
        useLatest: true,
      })
    );

    const event = dispatchUndo(target);

    expect(undo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not treat contenteditable=false as a native history owner', () => {
    const target = document.createElement('div');

    target.setAttribute('contenteditable', 'false');
    document.body.append(target);

    renderHook(() =>
      useDatabaseRowHistoryHotkeys(undefined, {
        ignoreInput: true,
        useLatest: true,
      })
    );

    const event = dispatchUndo(target);

    expect(undo).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('falls back to the active element when the event has no element target', () => {
    const input = document.createElement('input');

    document.body.append(input);
    input.focus();

    renderHook(() =>
      useDatabaseRowHistoryHotkeys(undefined, {
        ignoreInput: true,
        useLatest: true,
      })
    );

    const event = dispatchUndo(document);

    expect(undo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('removes the keydown listener on unmount', () => {
    const target = document.createElement('div');

    document.body.append(target);

    const { unmount } = renderHook(() =>
      useDatabaseRowHistoryHotkeys(undefined, {
        ignoreInput: true,
        useLatest: true,
      })
    );

    unmount();
    dispatchUndo(target);

    expect(undo).not.toHaveBeenCalled();
  });
});
