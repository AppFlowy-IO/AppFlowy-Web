import { act, renderHook } from '@testing-library/react';

import { useDatabaseHistoryManager } from '@/application/database-yjs';
import { useDatabaseRowHistoryHotkeys } from '@/components/database/hooks/useDatabaseRowHistoryHotkeys';

jest.mock('@/application/database-yjs', () => ({
  useDatabaseHistoryManager: jest.fn(),
}));

const mockUseDatabaseHistoryManager = jest.mocked(useDatabaseHistoryManager);

function createHistoryManager({
  canRedo = true,
  canUndo = true,
  redo = jest.fn(),
  undo = jest.fn(),
}: {
  canRedo?: boolean;
  canUndo?: boolean;
  redo?: jest.Mock;
  undo?: jest.Mock;
} = {}) {
  return {
    canRedo: jest.fn(() => canRedo),
    canUndo: jest.fn(() => canUndo),
    redo,
    subscribe: jest.fn(),
    undo,
  } as unknown as ReturnType<typeof useDatabaseHistoryManager>;
}

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
  let manager: ReturnType<typeof useDatabaseHistoryManager>;

  beforeEach(() => {
    manager = createHistoryManager({ redo, undo });
    mockUseDatabaseHistoryManager.mockReturnValue(manager);
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
    expect(manager.canUndo).toHaveBeenCalledTimes(1);
    expect(manager.subscribe).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('reads availability when the key is pressed without subscribing the owner to history state', () => {
    const unavailableManager = createHistoryManager({ canUndo: false, undo });
    const target = document.createElement('div');

    mockUseDatabaseHistoryManager.mockReturnValue(unavailableManager);
    document.body.append(target);

    renderHook(() =>
      useDatabaseRowHistoryHotkeys(undefined, {
        ignoreInput: true,
        useLatest: true,
      })
    );

    const event = dispatchUndo(target);

    expect(unavailableManager.canUndo).toHaveBeenCalledTimes(1);
    expect(unavailableManager.subscribe).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('switches the document listener to a replacement manager after commit', () => {
    const firstUndo = jest.fn();
    const secondUndo = jest.fn();
    const firstManager = createHistoryManager({ undo: firstUndo });
    const secondManager = createHistoryManager({ undo: secondUndo });
    const target = document.createElement('div');

    mockUseDatabaseHistoryManager.mockReturnValue(firstManager);
    document.body.append(target);

    const { rerender } = renderHook(() =>
      useDatabaseRowHistoryHotkeys(undefined, {
        ignoreInput: true,
        useLatest: true,
      })
    );

    dispatchUndo(target);
    mockUseDatabaseHistoryManager.mockReturnValue(secondManager);
    rerender();
    dispatchUndo(target);

    expect(firstUndo).toHaveBeenCalledTimes(1);
    expect(secondUndo).toHaveBeenCalledTimes(1);
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

  it('uses database history for an input that explicitly yields history hotkeys', () => {
    const target = document.createElement('input');

    target.setAttribute('data-database-history-hotkeys', 'true');
    document.body.append(target);
    target.focus();

    renderHook(() =>
      useDatabaseRowHistoryHotkeys(undefined, {
        ignoreInput: true,
        useLatest: true,
      })
    );

    const undoEvent = dispatchUndo(target);
    const redoEvent = dispatchRedo(target);

    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);
    expect(undoEvent.defaultPrevented).toBe(true);
    expect(redoEvent.defaultPrevented).toBe(true);
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
