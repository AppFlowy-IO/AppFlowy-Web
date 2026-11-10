import { EventEmitter } from 'events';

import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
import { emit, EventType } from '@/application/session/event';
import {
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
} from '@/application/types';

import {
  clearMentionSearchCacheForTests,
  ensureMentionSearchCacheScope,
  forgetMentionSearchView,
  getCachedMentionSearch,
  getCachedMentionSections,
  getRevokedMentionViews,
  markMentionSearchCacheStale,
  markMentionSearchRetryLater,
  MENTION_SEARCH_CACHE_FRESH_MS,
  mentionItemShowsAnyView,
  mentionSearchCacheStamp,
  mentionSearchRetryLaterRemainingMs,
  restoreMentionSearchView,
  setCachedMentionSections,
  startMentionSearchRefresh,
  subscribeMentionSearchCacheInvalidation,
  subscribeRevokedMentionViews,
  withoutMentionView,
  withoutRevokedMentionViews,
} from '../mentionSearchCache';

function pages(...items: MentionSearchResultItem[]): MentionSearchSection[] {
  return [{ kind: MentionSearchSectionKind.Pages, title: 'Pages', status: 'ok', has_more: false, items }];
}

function page(id: string): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Page,
    object_id: id,
    title: id,
    mention: { type: MentionTargetKind.Page, page_id: id },
  };
}

describe('mentionSearchCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    clearMentionSearchCacheForTests();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not treat a retry-later cooldown as cached mention data', () => {
    markMentionSearchRetryLater('empty-query', {
      code: ERROR_CODE.RETRY_LATER,
      message: 'retry later',
    });

    expect(mentionSearchRetryLaterRemainingMs('empty-query')).toBeGreaterThan(0);
    expect(getCachedMentionSections('empty-query')).toBeUndefined();
  });

  it('keeps cached mention data available while retry-later cooldown is active', () => {
    const sections = pages();

    setCachedMentionSections('page-query', sections);
    markMentionSearchRetryLater('page-query', {
      code: ERROR_CODE.RETRY_LATER,
      message: 'retry later',
    });

    expect(mentionSearchRetryLaterRemainingMs('page-query')).toBeGreaterThan(0);
    expect(getCachedMentionSections('page-query')).toBe(sections);
  });

  it('deduplicates in-flight refreshes for the same cache key, and gives every caller its result', async () => {
    let requestCount = 0;
    const refresh = () => {
      requestCount += 1;
      return Promise.resolve(`answer ${requestCount}`);
    };

    const first = startMentionSearchRefresh('page-query', refresh);
    const second = startMentionSearchRefresh('page-query', refresh);

    expect(second).toBe(first);
    await expect(second).resolves.toBe('answer 1');
    expect(requestCount).toBe(1);

    // A settled refresh is not joined: the next one runs.
    await expect(startMentionSearchRefresh('page-query', refresh)).resolves.toBe('answer 2');
  });

  describe('freshness', () => {
    it('serves an answer as fresh for 10 s after it was cached', () => {
      setCachedMentionSections('road', pages(page('Roadmap')));

      jest.advanceTimersByTime(MENTION_SEARCH_CACHE_FRESH_MS - 1);
      expect(getCachedMentionSearch('road')).toMatchObject({ fresh: true, sections: pages(page('Roadmap')) });

      jest.advanceTimersByTime(1);
      expect(getCachedMentionSearch('road')).toMatchObject({ fresh: false, sections: pages(page('Roadmap')) });
    });

    it('marks every answer stale, which keeps it but revalidates it on its next use', () => {
      setCachedMentionSections('road', pages(page('Roadmap')));
      setCachedMentionSections('', pages(page('Recent')));

      markMentionSearchCacheStale();

      expect(getCachedMentionSearch('road')).toMatchObject({ fresh: false, sections: pages(page('Roadmap')) });
      expect(getCachedMentionSearch('')).toMatchObject({ fresh: false, sections: pages(page('Recent')) });

      // A newer answer is fresh again.
      setCachedMentionSections('road', pages(page('Roadmap 2')), mentionSearchCacheStamp());
      expect(getCachedMentionSearch('road')?.fresh).toBe(true);
    });

    it('stores an answer to a request sent before a stale mark as stale', () => {
      const stamp = mentionSearchCacheStamp();

      markMentionSearchCacheStale();
      setCachedMentionSections('road', pages(page('Roadmap')), stamp);

      expect(getCachedMentionSearch('road')).toMatchObject({ fresh: false, sections: pages(page('Roadmap')) });
    });

    it('keeps the stale mark across a cooldown and a refresh bookkeeping write', async () => {
      setCachedMentionSections('road', pages(page('Roadmap')));
      markMentionSearchCacheStale();
      markMentionSearchRetryLater('road');
      await startMentionSearchRefresh('road', () => Promise.resolve());

      expect(getCachedMentionSearch('road')?.fresh).toBe(false);
    });
  });

  describe('clearing', () => {
    it('drops every answer when the session ends, and an answer to a request sent before', () => {
      const stamp = mentionSearchCacheStamp();

      setCachedMentionSections('road', pages(page('Roadmap')));
      emit(EventType.SESSION_INVALID);

      expect(getCachedMentionSections('road')).toBeUndefined();

      setCachedMentionSections('road', pages(page('Roadmap')), stamp);
      expect(getCachedMentionSections('road')).toBeUndefined();

      setCachedMentionSections('road', pages(page('Roadmap')), mentionSearchCacheStamp());
      expect(getCachedMentionSections('road')).toEqual(pages(page('Roadmap')));
    });

    it('drops every answer when a panel opens on another workspace or account', () => {
      ensureMentionSearchCacheScope('workspace-a');
      setCachedMentionSections('a-road', pages(page('Roadmap')));

      ensureMentionSearchCacheScope('workspace-a');
      expect(getCachedMentionSections('a-road')).toBeDefined();

      const stamp = mentionSearchCacheStamp();

      ensureMentionSearchCacheScope('workspace-b');
      expect(getCachedMentionSections('a-road')).toBeUndefined();

      // A late answer from the previous workspace is not stored either.
      setCachedMentionSections('a-road', pages(page('Roadmap')), stamp);
      expect(getCachedMentionSections('a-road')).toBeUndefined();
    });
  });

  describe('a revoked view', () => {
    const revoked = 'view-revoked';

    it('is dropped from every answer, as a page, a database view or a row of it, and every answer turns stale', () => {
      const database: MentionSearchResultItem = {
        kind: MentionTargetKind.Database,
        object_id: 'database-1',
        title: 'Tasks',
        database_view_id: revoked,
        mention: { type: MentionTargetKind.Database, database_id: 'database-1', database_view_id: revoked },
      };
      const row: MentionSearchResultItem = {
        kind: MentionTargetKind.DatabaseRow,
        object_id: 'row-1',
        title: 'Row',
        mention: {
          type: MentionTargetKind.DatabaseRow,
          database_id: 'database-1',
          database_view_id: revoked,
          row_id: 'row-1',
        },
      };
      // A person's payload names the page the person would be mentioned on.
      const person: MentionSearchResultItem = {
        kind: MentionTargetKind.Person,
        object_id: 'ada',
        title: 'Ada',
        mention: { type: MentionTargetKind.Person, person_id: 'ada', person_name: 'Ada', page_id: revoked },
      };
      const people: MentionSearchSection = {
        kind: MentionSearchSectionKind.People,
        title: 'People',
        status: 'ok',
        has_more: false,
        items: [person],
      };

      setCachedMentionSections('road', [people, ...pages(page(revoked), page('kept'), database, row)]);
      setCachedMentionSections('other', pages(page('other')));

      forgetMentionSearchView(revoked);

      expect(getCachedMentionSearch('road')).toEqual({
        sections: [people, ...pages(page('kept'))],
        cachedAt: expect.any(Number),
        fresh: false,
      });
      expect(getCachedMentionSearch('other')).toMatchObject({ fresh: false, sections: pages(page('other')) });
    });

    it('is left out of an answer to a request sent before the revoke that arrives after it', () => {
      const stamp = mentionSearchCacheStamp();

      forgetMentionSearchView(revoked);
      setCachedMentionSections('road', pages(page(revoked), page('kept')), stamp);

      expect(getCachedMentionSearch('road')).toMatchObject({ fresh: false, sections: pages(page('kept')) });
      expect(withoutRevokedMentionViews(pages(page(revoked), page('kept')), stamp)).toEqual(pages(page('kept')));

      // Access may be granted again: an answer to a request sent after the revoke keeps the view.
      const later = mentionSearchCacheStamp();
      const answer = pages(page(revoked), page('kept'));

      setCachedMentionSections('road', answer, later);
      expect(getCachedMentionSearch('road')).toMatchObject({ fresh: true, sections: answer });
      expect(withoutRevokedMentionViews(answer, later)).toBe(answer);
    });

    it('leaves sections without the view as they are', () => {
      const sections = pages(page('kept'));

      expect(withoutMentionView(sections, revoked)).toBe(sections);
      expect(withoutMentionView(pages(page(revoked), page('kept')), revoked)).toEqual(sections);
    });

    it('counts as revoked until access returns, telling the subscribers of each change', () => {
      const listener = jest.fn();
      const unsubscribe = subscribeRevokedMentionViews(listener);

      forgetMentionSearchView(revoked);
      const revokedViews = getRevokedMentionViews();

      expect([...revokedViews]).toEqual([revoked]);
      // The same set until it changes, as useSyncExternalStore needs.
      expect(getRevokedMentionViews()).toBe(revokedViews);
      restoreMentionSearchView('never-revoked');
      expect(getRevokedMentionViews()).toBe(revokedViews);
      expect(listener).toHaveBeenCalledTimes(1);

      restoreMentionSearchView(revoked);
      expect(getRevokedMentionViews().size).toBe(0);
      expect(listener).toHaveBeenCalledTimes(2);

      // A clear (sign-out, another workspace or account) forgets every revoke.
      forgetMentionSearchView(revoked);
      clearMentionSearchCacheForTests();
      expect(getRevokedMentionViews().size).toBe(0);
      expect(listener).toHaveBeenCalledTimes(4);

      unsubscribe();
      forgetMentionSearchView(revoked);
      expect(listener).toHaveBeenCalledTimes(4);
    });

    it('keeps only the last 100 revokes', () => {
      for (let n = 0; n <= 100; n += 1) forgetMentionSearchView(`view-${n}`);

      expect(getRevokedMentionViews().size).toBe(100);
      expect(getRevokedMentionViews().has('view-0')).toBe(false);
      expect(getRevokedMentionViews().has('view-100')).toBe(true);
    });

    it('no longer leaves a view out of a late answer once access to it returns', () => {
      const stamp = mentionSearchCacheStamp();
      const answer = pages(page(revoked), page('kept'));

      forgetMentionSearchView(revoked);
      restoreMentionSearchView(revoked);

      expect(withoutRevokedMentionViews(answer, stamp)).toBe(answer);
    });

    it('tells the items that show a view: the page, the database view or a row of it, never a person', () => {
      const viewIds = new Set([revoked]);
      const database: MentionSearchResultItem = {
        kind: MentionTargetKind.Database,
        object_id: 'database-1',
        title: 'Tasks',
        database_view_id: revoked,
        mention: { type: MentionTargetKind.Database, database_id: 'database-1', database_view_id: revoked },
      };
      const row: MentionSearchResultItem = {
        kind: MentionTargetKind.DatabaseRow,
        object_id: 'row-1',
        title: 'Row',
        mention: {
          type: MentionTargetKind.DatabaseRow,
          database_id: 'database-1',
          database_view_id: revoked,
          row_id: 'row-1',
        },
      };
      const person: MentionSearchResultItem = {
        kind: MentionTargetKind.Person,
        object_id: 'ada',
        title: 'Ada',
        mention: { type: MentionTargetKind.Person, person_id: 'ada', person_name: 'Ada', page_id: revoked },
      };

      expect(
        [page(revoked), database, row, person, page('kept')].map((item) => mentionItemShowsAnyView(item, viewIds))
      ).toEqual([true, true, true, false, false]);
      expect(mentionItemShowsAnyView(page(revoked), new Set())).toBe(false);
    });
  });

  describe('send order', () => {
    it('never lets an answer replace the stored answer to a request sent after it', () => {
      const older = mentionSearchCacheStamp();
      const newer = mentionSearchCacheStamp();

      setCachedMentionSections('', pages(page('New page')), newer);
      setCachedMentionSections('', pages(page('Old page')), older);

      expect(getCachedMentionSearch('')).toMatchObject({ fresh: true, sections: pages(page('New page')) });

      // The answer to a newer request still replaces it.
      setCachedMentionSections('', pages(page('Newest page')), mentionSearchCacheStamp());
      expect(getCachedMentionSections('')).toEqual(pages(page('Newest page')));
    });

    it('keeps the send order across a cooldown, a refresh and a stale mark', async () => {
      const older = mentionSearchCacheStamp();

      setCachedMentionSections('road', pages(page('New page')), mentionSearchCacheStamp());
      markMentionSearchRetryLater('road');
      await startMentionSearchRefresh('road', () => Promise.resolve());
      markMentionSearchCacheStale();
      setCachedMentionSections('road', pages(page('Old page')), older);

      expect(getCachedMentionSections('road')).toEqual(pages(page('New page')));
    });
  });

  describe('workspace events', () => {
    it.each([
      APP_EVENTS.SECTION_CHANGED,
      APP_EVENTS.MENTIONABLE_PERSON_LIST_CHANGED,
      APP_EVENTS.FOLDER_OUTLINE_CHANGED,
      APP_EVENTS.FOLDER_VIEW_CHANGED,
      APP_EVENTS.PERMISSION_CHANGED,
    ])('marks every answer stale on %s', (event) => {
      const eventEmitter = new EventEmitter();

      subscribeMentionSearchCacheInvalidation(eventEmitter);
      setCachedMentionSections('road', pages(page('Roadmap')));

      eventEmitter.emit(event, { any: 'payload' });

      expect(getCachedMentionSearch('road')).toMatchObject({ fresh: false, sections: pages(page('Roadmap')) });
    });

    it('drops a revoked view on VIEW_ACCESS_REVOKED', () => {
      const eventEmitter = new EventEmitter();

      subscribeMentionSearchCacheInvalidation(eventEmitter);
      setCachedMentionSections('road', pages(page('gone'), page('kept')));

      eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: 'gone' });

      expect(getCachedMentionSearch('road')).toMatchObject({ fresh: false, sections: pages(page('kept')) });
    });

    it('counts a view as revoked from VIEW_ACCESS_REVOKED until VIEW_ACCESS_RESTORED', () => {
      const eventEmitter = new EventEmitter();

      subscribeMentionSearchCacheInvalidation(eventEmitter);
      eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: 'gone' });
      eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: 'back' });
      eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_RESTORED, { viewId: 'back' });
      eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_RESTORED, {});

      expect([...getRevokedMentionViews()]).toEqual(['gone']);
    });

    it('subscribes once per emitter, however many panels mount', () => {
      const eventEmitter = new EventEmitter();

      subscribeMentionSearchCacheInvalidation(eventEmitter);
      subscribeMentionSearchCacheInvalidation(eventEmitter);
      subscribeMentionSearchCacheInvalidation(undefined);

      expect(eventEmitter.listenerCount(APP_EVENTS.FOLDER_VIEW_CHANGED)).toBe(1);
      expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_ACCESS_REVOKED)).toBe(1);
      expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_ACCESS_RESTORED)).toBe(1);
    });
  });
});
