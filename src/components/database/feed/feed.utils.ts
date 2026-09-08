import dayjs from 'dayjs';

import type { Row } from '@/application/database-yjs';

export type FeedTranslate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Desktop Feed sorts rows by `rowMeta.createdAt` descending whenever the view
 * has no sorts. Rows whose creation time is still unknown (their row doc has
 * not hydrated yet) keep their relative view order after the resolved rows so
 * the list stays stable while docs stream in.
 */
export function sortFeedRowsByCreatedAt(rows: Row[], getCreatedAt: (rowId: string) => number | undefined): Row[] {
  const resolved: Array<{ row: Row; createdAt: number; index: number }> = [];
  const unresolved: Row[] = [];

  rows.forEach((row, index) => {
    const createdAt = getCreatedAt(row.id);

    if (createdAt === undefined || Number.isNaN(createdAt)) {
      unresolved.push(row);
      return;
    }

    resolved.push({ row, createdAt, index });
  });

  resolved.sort((left, right) => right.createdAt - left.createdAt || left.index - right.index);

  return [...resolved.map(({ row }) => row), ...unresolved];
}

export function toUnixSeconds(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;

  const numeric = typeof value === 'bigint' ? Number(value) : Number(value);

  if (!Number.isFinite(numeric)) return undefined;

  // Desktop stores seconds; tolerate millisecond timestamps from other writers.
  return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}

/** `FeedCard._formatCreatorDate`: time today, "1 day ago", then short dates. */
export function formatFeedCreatorDate(createdAtSeconds: number, t: FeedTranslate, now = dayjs()): string {
  const created = dayjs.unix(createdAtSeconds);
  const diffDays = now.startOf('day').diff(created.startOf('day'), 'day');

  if (diffDays <= 0) return created.format('h:mm A');
  if (diffDays === 1) return t('globalComment.showDays', { count: 1 });
  if (created.year() === now.year()) return created.format('MMM D');

  return created.format('MMM D, YYYY');
}

/** `FeedCard._formatTimestamp`: relative time for the latest comment. */
export function formatFeedRelativeTime(seconds: number, t: FeedTranslate, now = dayjs()): string {
  const time = dayjs.unix(seconds);
  const diffSeconds = Math.max(0, now.diff(time, 'second'));
  const diffMinutes = now.diff(time, 'minute');
  const diffHours = now.diff(time, 'hour');
  const diffDays = now.diff(time, 'day');

  if (diffDays <= 0) {
    if (diffHours <= 0) {
      if (diffMinutes <= 0) return t('globalComment.showSeconds', { count: diffSeconds });

      return t('globalComment.showMinutes', { count: diffMinutes });
    }

    return t('globalComment.showHours', { count: diffHours });
  }

  if (diffDays < 7) return t('globalComment.showDays', { count: diffDays });

  return time.format('MMM D, YYYY');
}

export function isFeedRowEdited(
  createdAtSeconds: number | undefined,
  modifiedAtSeconds: number | undefined,
  thresholdSeconds: number
): boolean {
  if (createdAtSeconds === undefined || modifiedAtSeconds === undefined) return false;

  return modifiedAtSeconds > createdAtSeconds && modifiedAtSeconds - createdAtSeconds > thresholdSeconds;
}

const FEED_INTERACTIVE_TARGET_SELECTOR = [
  'a',
  'button',
  'input',
  'label',
  'select',
  'textarea',
  '[contenteditable]:not([contenteditable="false"])',
  '[data-feed-interactive="true"]',
  '[role="button"]',
  '[role="menu"]',
].join(',');

/**
 * True when the click landed on a control inside the card.
 *
 * The lookup must stop at the card: a linked feed lives inside the document
 * editor's `contenteditable` root (and page modals expose `role` attributes),
 * so an unbounded `closest()` would classify every click as interactive and
 * the card would never open its row.
 */
export function isFeedInteractiveTarget(target: EventTarget | null, boundary?: Element | null): boolean {
  if (!(target instanceof Element)) return false;

  const control = target.closest(FEED_INTERACTIVE_TARGET_SELECTOR);

  if (!control) return false;
  if (!boundary) return true;

  return control !== boundary && boundary.contains(control);
}
