/**
 * What the editor's @ picker shows about a result besides its title (MEN-WEB-13), behind the item
 * details switch, off by default until design signs off on the treatment
 * (`localStorage.__mention_item_details = 'true'`, read when a picker opens):
 *
 * - A muted breadcrumb under a page, database or row: the item's `path`, which every released
 *   server sends with `path_status`, shown only when that status is `complete`. A path Search left
 *   out (shed for load, or not resolved) shows nothing, and so does an item from a server that sends
 *   none. The `subtitle` servers send for these items (the same path joined, or "Database") is never
 *   shown: it is English, and Web has always hidden it.
 * - A person's avatar from the roster, by person id: a picker that lists people loads it once per
 *   opening through the roster cache (`useMentionRosterOnOpen`). No server sets a person's `icon`:
 *   until the roster arrives, or when it cannot load, the person shows initials, as before.
 * - A page's or database's icon from the local index (the outline's view icons and layouts,
 *   MEN-WEB-07). A server's `icon` is never drawn: servers type it as an object whose `ty` is a
 *   string, where the outline numbers its icon types, and none sets it.
 * - At most one reason chip ({@link mentionReasonChip}): "Opened 3 min ago", "Created just now" or
 *   "On this page", from what the tab knows (its opens and creations, the recent views, the
 *   outline's creation times and who is on the page) and from the reasons a server sends to a
 *   request that opted into them (Cloud MEN-X-09, `reasons_v1`; the picker does not send it yet).
 *   A signal the picker has no copy for shows nothing. Nothing ever says "Edited": the Folder's
 *   edit times, the server's `changed` signal among them, reflect only metadata changes.
 *
 * Whatever the switch, a value that is not a string never reaches an image source
 * ({@link mentionImageSource}) or a saved mention (`mentionUtils.ts`). Nothing here depends on
 * React or the network.
 */
import { MentionablePerson, MentionSearchResultItem, MentionTargetKind } from '@/application/types';

import { MENTION_FRESH_MS } from './mentionLocalMerge';
import { mentionLocalPersonOfId, mentionLocalViewOfKey } from './mentionPickRanking';
import { mentionDatabaseNavKey, mentionItemNavKey, mentionPageNavKey } from './mentionUtils';

import type { MentionLocalSnapshot, MentionLocalView } from './mentionLocalIndex';

/** Whether a picker that opens now shows breadcrumbs, roster avatars, view icons and reason chips. */
export const MENTION_ITEM_DETAILS_DEFAULT = false;
/** `localStorage` key that turns the item details on (`true`) or off (`false`). */
export const MENTION_ITEM_DETAILS_OVERRIDE_KEY = '__mention_item_details';

/**
 * Whether a picker that opens now shows the item details: {@link MENTION_ITEM_DETAILS_DEFAULT}
 * unless the browser overrides it, with or without the picker's v2. Storage that cannot be read
 * gives the default.
 */
export function readMentionItemDetailsEnabled(): boolean {
  try {
    const value =
      typeof window === 'undefined' ? null : window.localStorage?.getItem(MENTION_ITEM_DETAILS_OVERRIDE_KEY) ?? null;

    return value === 'true' ? true : value === 'false' ? false : MENTION_ITEM_DETAILS_DEFAULT;
  } catch {
    return MENTION_ITEM_DETAILS_DEFAULT;
  }
}

/** What the item details read besides the item itself, once per picker render. */
export interface MentionItemDetails {
  /** The local index: view icons, layouts and times, and the roster the tab loaded. */
  snapshot: MentionLocalSnapshot;
  /** People on the page now (awareness), by person id, without the requester. */
  presentPersonIds: ReadonlySet<string>;
  /** The page or database view the editor shows, which gets no chip: the user is on it. */
  contextViewId?: string;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** A creation at most this old names the chip even after an open: it is why the item is new. */
export const MENTION_CHIP_CREATION_FIRST_MS = MENTION_FRESH_MS;
/** An open at most this old shows as "Opened …". */
export const MENTION_CHIP_OPENED_WITHIN_MS = 7 * DAY_MS;
/** A creation at most this old shows as "Created …". */
export const MENTION_CHIP_CREATED_WITHIN_MS = DAY_MS;

/** The server reasons a chip has copy for (Cloud MEN-X-09's `MENTION_REASON_*` values). */
const REASON_VIEWED = 'viewed';
const REASON_CREATED = 'created';
const REASON_PARTICIPANT = 'participant';

const PAGE_LIKE_KINDS: ReadonlySet<MentionTargetKind> = new Set([
  MentionTargetKind.Page,
  MentionTargetKind.Database,
  MentionTargetKind.DatabaseRow,
]);

/** Whether `kind` is a page, a database or a row: the items that show a breadcrumb, not a subtitle. */
export function isMentionPageLikeKind(kind: MentionTargetKind): boolean {
  return PAGE_LIKE_KINDS.has(kind);
}

/**
 * `value` when it is a string an image can load from (`http(s)`, `data:`, `blob:` or a path), else
 * `undefined`: an object, such as the icon servers type, never becomes an image source.
 */
export function mentionImageSource(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;

  return /^https?:\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:') || value.startsWith('/')
    ? value
    : undefined;
}

/**
 * The breadcrumb of a page, database or row: its `path` titles joined by " / ", root first, when
 * `path_status` is `complete`. Blank titles are left out, as Search leaves them out; `undefined`
 * when nothing is left, when the path was omitted or is missing, and for any other kind.
 */
export function mentionItemBreadcrumb(item: MentionSearchResultItem): string | undefined {
  if (!isMentionPageLikeKind(item.kind) || item.path_status !== 'complete' || !Array.isArray(item.path)) {
    return undefined;
  }

  const titles = item.path.flatMap((segment) => {
    const title = typeof segment?.title === 'string' ? segment.title.trim() : '';

    return title ? [title] : [];
  });

  return titles.length > 0 ? titles.join(' / ') : undefined;
}

/** The person id a person item names: its payload's, else its object id. */
export function mentionItemPersonId(item: MentionSearchResultItem): string | undefined {
  if (item.kind !== MentionTargetKind.Person) return undefined;

  const personId = (item.mention as { person_id?: unknown }).person_id;

  return (typeof personId === 'string' && personId) || item.object_id || undefined;
}

/** The roster member a person item names, from the roster the tab loaded. */
export function mentionItemRosterPerson(
  snapshot: MentionLocalSnapshot,
  item: MentionSearchResultItem
): MentionablePerson | undefined {
  const personId = mentionItemPersonId(item);

  if (!personId) return undefined;

  return mentionLocalPersonOfId(snapshot, personId) ?? mentionLocalPersonOfId(snapshot, personId.toLowerCase());
}

/**
 * The image a person's avatar shows: the roster's avatar, else a string `icon` (the shape older Web
 * code expected); never an object.
 */
export function mentionPersonAvatarSource(
  item: MentionSearchResultItem,
  person: MentionablePerson | undefined
): string | undefined {
  return mentionImageSource(person?.avatar_url) ?? mentionImageSource(item.icon);
}

/**
 * The local index's view of a page or database item, by its navigation key: a page by its id, a
 * database by its database and view, or by its database alone while the index does not know its
 * view (one this tab just created). Rows, people and quick picks have none.
 */
export function mentionItemLocalView(
  snapshot: MentionLocalSnapshot,
  item: MentionSearchResultItem,
  navKey = mentionItemNavKey(item)
): MentionLocalView | undefined {
  if (item.kind === MentionTargetKind.Page) return mentionLocalViewOfKey(snapshot, navKey);
  if (item.kind !== MentionTargetKind.Database) return undefined;

  const view = mentionLocalViewOfKey(snapshot, navKey);

  if (view) return view;

  const databaseId = /^database:([^:]+):/.exec(navKey)?.[1];

  return databaseId && databaseId !== '-'
    ? mentionLocalViewOfKey(snapshot, mentionDatabaseNavKey(databaseId, undefined))
    : undefined;
}

/**
 * Whether an item is the page or database view the editor shows (`contextViewId`), as the local lane
 * tells it (`mentionLocalLane.ts`): opening it made it the tab's latest open, so it gets no chip.
 */
export function mentionItemIsContext(
  item: MentionSearchResultItem,
  view: MentionLocalView | undefined,
  contextViewId: string | undefined,
  navKey = mentionItemNavKey(item)
): boolean {
  if (!contextViewId) return false;
  if (view && (view.viewId === contextViewId || view.databaseViewId === contextViewId)) return true;
  if (item.kind === MentionTargetKind.Page) return navKey === mentionPageNavKey(contextViewId);
  if (item.kind !== MentionTargetKind.Database) return false;

  const databaseViewId = (item.mention as { database_view_id?: unknown }).database_view_id ?? item.database_view_id;

  return databaseViewId === contextViewId;
}

/** A reason chip: when the item was opened or created, or that the person is on the page. */
export type MentionReasonChip = { kind: 'opened' | 'created'; atMs: number } | { kind: 'onThisPage' };

export interface MentionReasonChipInput {
  item: MentionSearchResultItem;
  /** The local index's view of the item, when it lists one ({@link mentionItemLocalView}). */
  view?: MentionLocalView;
  /** The person is on the page now (awareness). */
  present?: boolean;
  /** The item is the page or database view the editor shows ({@link mentionItemIsContext}). */
  context?: boolean;
  nowMs: number;
}

function validTime(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function latest(...times: unknown[]): number | undefined {
  let found: number | undefined;

  times.forEach((value) => {
    const time = validTime(value);

    if (time !== undefined && (found === undefined || time > found)) found = time;
  });
  return found;
}

/**
 * The one chip an item shows, if any:
 * - a person on the page now (awareness), or one the server names a `participant` of it: "On this
 *   page". The server's `mentioned` (the requester's own mention) and `interaction` (a mention,
 *   comment, reply, share or assignment from them, or for a page a notification) have no copy yet:
 *   "Mentioned you" would mislabel most interactions.
 * - a page, database or row: when it was opened (this tab's open, the recent views' last view, or
 *   the server's `viewed`) or created (this tab's creation, else the outline's creation time, or the
 *   server's `created`). A creation in the last {@link MENTION_CHIP_CREATION_FIRST_MS} wins, as it is
 *   why the item is new; otherwise the newer of an open in the last
 *   {@link MENTION_CHIP_OPENED_WITHIN_MS} and a creation in the last
 *   {@link MENTION_CHIP_CREATED_WITHIN_MS}, an open winning a tie: Cloud names an item by its newest
 *   event, and by a view when the view is at least as new.
 * - nothing for the page being edited, for quick picks and links, and for every other server
 *   signal (`near`, `current`, `match`, `changed`, and values this client does not know). No edit
 *   time is ever read.
 *
 * A time ahead of `nowMs`, from a clock that stepped back, counts as now.
 */
export function mentionReasonChip({
  item,
  view,
  present,
  context,
  nowMs,
}: MentionReasonChipInput): MentionReasonChip | undefined {
  if (context) return undefined;

  const signal = typeof item.reason?.signal === 'string' ? item.reason.signal : undefined;
  const serverAt = validTime(item.reason?.at);

  if (item.kind === MentionTargetKind.Person) {
    return present || signal === REASON_PARTICIPANT ? { kind: 'onThisPage' } : undefined;
  }

  if (!isMentionPageLikeKind(item.kind)) return undefined;

  const opened = latest(view?.sessionOpenedAt, view?.lastViewedAt, signal === REASON_VIEWED ? serverAt : undefined);
  const created = latest(view?.sessionCreatedAt ?? view?.createdAt, signal === REASON_CREATED ? serverAt : undefined);
  // A time ahead of the clock has a negative age, inside every window.
  const ageOf = (time: number) => nowMs - time;

  if (created !== undefined && ageOf(created) <= MENTION_CHIP_CREATION_FIRST_MS) {
    return { kind: 'created', atMs: created };
  }

  const openedShows = opened !== undefined && ageOf(opened) <= MENTION_CHIP_OPENED_WITHIN_MS;
  const createdShows = created !== undefined && ageOf(created) <= MENTION_CHIP_CREATED_WITHIN_MS;

  if (openedShows && (!createdShows || opened >= created)) return { kind: 'opened', atMs: opened };
  if (createdShows) return { kind: 'created', atMs: created };
  return undefined;
}

/** How long ago something happened, as a chip says it: just now, then whole minutes, hours or days. */
export type MentionChipAge = { unit: 'justNow' } | { unit: 'minutes' | 'hours' | 'days'; count: number };

/** How long before `nowMs` the event at `atMs` happened ({@link MentionChipAge}); a later time is just now. */
export function mentionChipAge(atMs: number, nowMs: number): MentionChipAge {
  const age = nowMs - atMs;

  if (age < MINUTE_MS) return { unit: 'justNow' };
  if (age < HOUR_MS) return { unit: 'minutes', count: Math.floor(age / MINUTE_MS) };
  if (age < DAY_MS) return { unit: 'hours', count: Math.floor(age / HOUR_MS) };
  return { unit: 'days', count: Math.floor(age / DAY_MS) };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

const AGE_KEYS = {
  minutes: 'document.mention.reason.minutesAgo',
  hours: 'document.mention.reason.hoursAgo',
  days: 'document.mention.reason.daysAgo',
} as const;

/** The chip's text in the user's language (`document.mention.reason` in `en.json`). */
export function mentionReasonChipLabel(chip: MentionReasonChip, nowMs: number, t: Translate): string {
  if (chip.kind === 'onThisPage') return t('document.mention.reason.onThisPage');

  const age = mentionChipAge(chip.atMs, nowMs);
  const time =
    age.unit === 'justNow' ? t('document.mention.reason.justNow') : t(AGE_KEYS[age.unit], { count: age.count });
  const key = chip.kind === 'opened' ? 'document.mention.reason.opened' : 'document.mention.reason.created';

  // The age is translated text, which React escapes: i18next must not escape it again ("un'ora fa").
  return t(key, { time, interpolation: { escapeValue: false } });
}
