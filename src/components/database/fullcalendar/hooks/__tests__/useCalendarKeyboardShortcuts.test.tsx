import { CalendarApi } from '@fullcalendar/core';
import { cleanup, createEvent, fireEvent, renderHook } from '@testing-library/react';
import { RefObject } from 'react';

import { CalendarViewType } from '../../types';
import { useCalendarKeyboardShortcuts } from '../useCalendarKeyboardShortcuts';

let wrapper: HTMLDivElement;
let calendarElement: HTMLDivElement;
let calendar: CalendarApi;
const onViewChange = jest.fn();
const onPrev = jest.fn();
const onNext = jest.fn();
const onToday = jest.fn();

function useShortcuts(toolbarRef: RefObject<HTMLDivElement | null> = { current: calendarElement }) {
  return useCalendarKeyboardShortcuts({
    calendar,
    currentView: CalendarViewType.DAY_GRID_MONTH,
    onViewChange,
    onPrev,
    onNext,
    onToday,
    toolbarRef,
  });
}

function press(target: Element, key: string, modifiers: KeyboardEventInit = {}) {
  const event = createEvent.keyDown(target, {
    key,
    code: /^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`,
    keyCode: key.toUpperCase().charCodeAt(0),
    which: key.toUpperCase().charCodeAt(0),
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });

  fireEvent(target, event);
  return event;
}

beforeEach(() => {
  jest.clearAllMocks();
  wrapper = document.createElement('div');
  wrapper.className = 'calendar-wrapper';
  calendarElement = document.createElement('div');
  calendarElement.className = 'fc';
  calendarElement.tabIndex = 0;
  wrapper.append(calendarElement);
  document.body.append(wrapper);
  calendar = { el: calendarElement } as unknown as CalendarApi;
});

afterEach(() => {
  cleanup();
  wrapper.remove();
});

it('handles view and navigation shortcuts inside the calendar without capturing another page', () => {
  renderHook(useShortcuts);
  const outside = document.createElement('button');

  document.body.append(outside);
  expect(press(outside, 'j').defaultPrevented).toBe(false);
  expect(onNext).not.toHaveBeenCalled();
  outside.remove();

  expect(press(calendarElement, 'w').defaultPrevented).toBe(true);
  expect(onViewChange).toHaveBeenLastCalledWith(CalendarViewType.TIME_GRID_WEEK);
  press(calendarElement, 'm');
  expect(onViewChange).toHaveBeenLastCalledWith(CalendarViewType.DAY_GRID_MONTH);
  press(calendarElement, 'k');
  press(calendarElement, 'j');
  press(calendarElement, 't');
  expect(onPrev).toHaveBeenCalledTimes(1);
  expect(onNext).toHaveBeenCalledTimes(1);
  expect(onToday).toHaveBeenCalledTimes(1);
  expect(press(calendarElement, 'x').defaultPrevented).toBe(false);
});

it('handles a key once when normal and sticky toolbars share the same calendar', () => {
  const normal = renderHook(useShortcuts);
  const sticky = renderHook(useShortcuts);

  press(calendarElement, 'j');
  expect(onNext).toHaveBeenCalledTimes(1);
  sticky.unmount();
  press(calendarElement, 'j');
  expect(onNext).toHaveBeenCalledTimes(2);
  normal.unmount();
  expect(press(calendarElement, 'j').defaultPrevented).toBe(false);
  expect(onNext).toHaveBeenCalledTimes(2);
});

it('handles shortcuts in a noneditable calendar island inside a document editor', () => {
  const editor = document.createElement('div');
  const databaseBlock = document.createElement('div');

  editor.setAttribute('contenteditable', 'true');
  editor.setAttribute('role', 'textbox');
  databaseBlock.setAttribute('contenteditable', 'false');
  editor.append(databaseBlock);
  databaseBlock.append(wrapper);
  document.body.append(editor);

  try {
    renderHook(() => useShortcuts());
    expect(press(calendarElement, 'j').defaultPrevented).toBe(true);
    expect(onNext).toHaveBeenCalledTimes(1);
  } finally {
    editor.remove();
  }
});

it('allows a containing dialog while ignoring a dialog opened inside the calendar', () => {
  const outerDialog = document.createElement('div');
  const innerDialog = document.createElement('div');
  const dialogButton = document.createElement('button');

  outerDialog.setAttribute('role', 'dialog');
  outerDialog.append(wrapper);
  innerDialog.setAttribute('role', 'dialog');
  innerDialog.append(dialogButton);
  calendarElement.append(innerDialog);
  document.body.append(outerDialog);

  try {
    renderHook(() => useShortcuts());
    expect(press(calendarElement, 'j').defaultPrevented).toBe(true);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(press(dialogButton, 'j').defaultPrevented).toBe(false);
    expect(onNext).toHaveBeenCalledTimes(1);
  } finally {
    outerDialog.remove();
  }
});

it('handles a sticky toolbar outside the calendar wrapper and releases it on unmount', () => {
  const stickyToolbar = document.createElement('div');
  const button = document.createElement('button');

  stickyToolbar.append(button);
  document.body.append(stickyToolbar);
  const { unmount } = renderHook(() => useShortcuts({ current: stickyToolbar }));

  press(button, 'j');
  expect(onNext).toHaveBeenCalledTimes(1);
  unmount();
  expect(press(button, 'j').defaultPrevented).toBe(false);
  expect(onNext).toHaveBeenCalledTimes(1);
  stickyToolbar.remove();
});

it.each([
  ['2', CalendarViewType.TIME_GRID_2_DAYS],
  ['3', CalendarViewType.TIME_GRID_3_DAYS],
  ['4', CalendarViewType.TIME_GRID_4_DAYS],
  ['5', CalendarViewType.TIME_GRID_5_DAYS],
  ['6', CalendarViewType.TIME_GRID_6_DAYS],
  ['8', CalendarViewType.TIME_GRID_8_DAYS],
])('selects the desktop date range for shortcut %s', (key, view) => {
  renderHook(() => useShortcuts());

  expect(press(calendarElement, key).defaultPrevented).toBe(true);
  expect(onViewChange).toHaveBeenCalledWith(view);
  expect(onViewChange).toHaveBeenCalledTimes(1);
});

it.each(['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const)('leaves %s shortcuts to their owner', (modifier) => {
  renderHook(useShortcuts);

  expect(press(calendarElement, 'j', { [modifier]: true }).defaultPrevented).toBe(false);
  expect(onNext).not.toHaveBeenCalled();
});

it.each([
  '<input />',
  '<textarea></textarea>',
  '<select><option>July</option></select>',
  '<div contenteditable="true"><span>Editing</span></div>',
  '<div role="dialog"><button>Dialog action</button></div>',
  '<div role="menu"><div role="menuitem" tabindex="0">Menu action</div></div>',
])('does not navigate while an editor or overlay handles keys: %s', (markup) => {
  renderHook(useShortcuts);
  calendarElement.innerHTML = markup;
  const target = calendarElement.querySelector('span, button, [role="menuitem"]') ?? calendarElement.firstElementChild!;

  expect(press(target, 'j').defaultPrevented).toBe(false);
  expect(onNext).not.toHaveBeenCalled();
});

it('does not process a key already handled by a nested control', () => {
  renderHook(useShortcuts);
  const child = document.createElement('button');

  child.addEventListener('keydown', (event) => event.preventDefault());
  calendarElement.append(child);
  press(child, 'j');
  expect(onNext).not.toHaveBeenCalled();
});

it.each([{ isComposing: true }, { repeat: true }])('ignores composing and repeated keys: %o', (options) => {
  renderHook(() => useShortcuts());

  expect(press(calendarElement, 'j', options).defaultPrevented).toBe(false);
  expect(onNext).not.toHaveBeenCalled();
});
