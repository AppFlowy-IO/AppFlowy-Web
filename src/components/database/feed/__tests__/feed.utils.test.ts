import dayjs from 'dayjs';

import {
  formatFeedCreatorDate,
  formatFeedRelativeTime,
  isFeedInteractiveTarget,
  isFeedRowEdited,
  sortFeedRowsByCreatedAt,
  toUnixSeconds,
} from '../feed.utils';

const t = (key: string, options?: Record<string, unknown>) =>
  options && 'count' in options ? `${key}:${String(options.count)}` : key;

describe('sortFeedRowsByCreatedAt', () => {
  const rows = [
    { id: 'a', height: 36 },
    { id: 'b', height: 36 },
    { id: 'c', height: 36 },
    { id: 'd', height: 36 },
  ];

  it('orders resolved rows newest first and keeps unresolved rows after them in view order', () => {
    const createdAt: Record<string, number | undefined> = { a: 100, b: 300, c: undefined, d: 200 };

    expect(sortFeedRowsByCreatedAt(rows, (rowId) => createdAt[rowId]).map((row) => row.id)).toEqual([
      'b',
      'd',
      'a',
      'c',
    ]);
  });

  it('is stable for equal timestamps', () => {
    expect(sortFeedRowsByCreatedAt(rows, () => 5).map((row) => row.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('toUnixSeconds', () => {
  it('accepts second and millisecond timestamps in several primitive shapes', () => {
    expect(toUnixSeconds('1700000000')).toBe(1700000000);
    expect(toUnixSeconds(1700000000)).toBe(1700000000);
    expect(toUnixSeconds(1700000000123)).toBe(1700000000);
    expect(toUnixSeconds(BigInt(1700000000))).toBe(1700000000);
    expect(toUnixSeconds('')).toBeUndefined();
    expect(toUnixSeconds(undefined)).toBeUndefined();
    expect(toUnixSeconds('not-a-number')).toBeUndefined();
  });
});

describe('formatFeedCreatorDate', () => {
  const now = dayjs('2024-06-15T15:30:00');

  it('shows the time for rows created today', () => {
    expect(formatFeedCreatorDate(dayjs('2024-06-15T09:05:00').unix(), t, now)).toBe('9:05 AM');
  });

  it('shows "1 day ago" for yesterday', () => {
    expect(formatFeedCreatorDate(dayjs('2024-06-14T23:59:00').unix(), t, now)).toBe('globalComment.showDays:1');
  });

  it('shows month and day within the same year and the full date otherwise', () => {
    expect(formatFeedCreatorDate(dayjs('2024-01-15T10:00:00').unix(), t, now)).toBe('Jan 15');
    expect(formatFeedCreatorDate(dayjs('2023-12-25T10:00:00').unix(), t, now)).toBe('Dec 25, 2023');
  });
});

describe('formatFeedRelativeTime', () => {
  const now = dayjs('2024-06-15T15:30:00');

  it('walks the Desktop relative buckets', () => {
    expect(formatFeedRelativeTime(now.subtract(20, 'second').unix(), t, now)).toBe('globalComment.showSeconds:20');
    expect(formatFeedRelativeTime(now.subtract(5, 'minute').unix(), t, now)).toBe('globalComment.showMinutes:5');
    expect(formatFeedRelativeTime(now.subtract(3, 'hour').unix(), t, now)).toBe('globalComment.showHours:3');
    expect(formatFeedRelativeTime(now.subtract(1, 'day').unix(), t, now)).toBe('globalComment.showDays:1');
    expect(formatFeedRelativeTime(now.subtract(4, 'day').unix(), t, now)).toBe('globalComment.showDays:4');
    expect(formatFeedRelativeTime(now.subtract(10, 'day').unix(), t, now)).toBe('Jun 5, 2024');
  });
});

describe('isFeedRowEdited', () => {
  it('requires the modification to be more than the threshold after creation', () => {
    expect(isFeedRowEdited(100, 100, 60)).toBe(false);
    expect(isFeedRowEdited(100, 150, 60)).toBe(false);
    expect(isFeedRowEdited(100, 161, 60)).toBe(true);
    expect(isFeedRowEdited(undefined, 161, 60)).toBe(false);
  });
});

describe('isFeedInteractiveTarget', () => {
  it('detects controls, editable regions, and opt-in interactive wrappers', () => {
    const container = document.createElement('div');

    container.innerHTML = `
      <span id="plain">plain</span>
      <button id="button"><span id="inner">x</span></button>
      <div data-feed-interactive="true"><span id="opt-in">y</span></div>
      <div contenteditable="true"><span id="editable">z</span></div>
      <div contenteditable="false"><span id="not-editable">w</span></div>
    `;

    expect(isFeedInteractiveTarget(container.querySelector('#plain'))).toBe(false);
    expect(isFeedInteractiveTarget(container.querySelector('#inner'))).toBe(true);
    expect(isFeedInteractiveTarget(container.querySelector('#opt-in'))).toBe(true);
    expect(isFeedInteractiveTarget(container.querySelector('#editable'))).toBe(true);
    expect(isFeedInteractiveTarget(container.querySelector('#not-editable'))).toBe(false);
    expect(isFeedInteractiveTarget(null)).toBe(false);
  });

  it('ignores interactive ancestors outside the card boundary (linked feed inside a document editor)', () => {
    const editor = document.createElement('div');

    editor.setAttribute('contenteditable', 'true');
    editor.innerHTML = `
      <div contenteditable="false">
        <article id="card" role="button">
          <span id="title">title</span>
          <button id="control"><span id="control-inner">x</span></button>
        </article>
      </div>
    `;

    const card = editor.querySelector('#card');

    expect(isFeedInteractiveTarget(editor.querySelector('#title'))).toBe(true);
    expect(isFeedInteractiveTarget(editor.querySelector('#title'), card)).toBe(false);
    expect(isFeedInteractiveTarget(editor.querySelector('#control-inner'), card)).toBe(true);
    expect(isFeedInteractiveTarget(card, card)).toBe(false);
  });
});
