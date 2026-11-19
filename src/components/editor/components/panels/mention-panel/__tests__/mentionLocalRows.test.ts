import { MentionSearchSection, MentionSearchSectionKind, MentionTargetKind, MentionType } from '@/application/types';

import { mergeMentionSections } from '../mentionLocalMerge';
import { objectTier, prepareMentionQuery, rankSection } from '../mentionLocalRanker';
import {
  MENTION_LOCAL_ROWS_LIMIT,
  mentionLocalRowCandidates,
  mentionLocalRowItem,
  mentionLocalRowNavKey,
  mentionLocalRowsForSections,
  MentionLocalRow,
  MentionLocalRowsSnapshot,
  rankMentionLocalRows,
} from '../mentionLocalRows';
import { mentionItemNavKey, mentionSearchItemToMention } from '../mentionUtils';

const DATABASE = '00000000-0000-4000-8000-0000000000db';
const VIEW = '00000000-0000-4000-8000-0000000000a1';
const NOW = Date.UTC(2026, 10, 11, 12);
const MINUTE = 60_000;

function rowId(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function snapshot(rows: MentionLocalRow[], complete = true): MentionLocalRowsSnapshot {
  return { databaseId: DATABASE, rows, complete };
}

function rows(...titles: string[]): MentionLocalRow[] {
  return titles.map((title, index) => ({ rowId: rowId(index + 1), title }));
}

function rank(
  query: string,
  source: MentionLocalRowsSnapshot,
  extra: Partial<Parameters<typeof rankMentionLocalRows>[0]> = {}
) {
  return rankMentionLocalRows({ query, snapshot: source, databaseViewId: VIEW, nowMs: NOW, ...extra });
}

function titles(items: { title: string }[]) {
  return items.map((item) => item.title);
}

describe('mentionLocalRows (MEN-WEB-15)', () => {
  describe('rankMentionLocalRows', () => {
    it('keeps the rows whose title matches at T3 or better, by tier, then length', () => {
      const source = snapshot(rows('Weekly road plan', 'Road', 'Roadmap Q3', 'Off-road trip', 'Budget', 'Railroad'));

      // T0 "Road", T1 "Roadmap Q3", T2 "Weekly road plan" and "Off-road trip" (a word starts with it),
      // T3 "Railroad" (contains it); "Budget" does not match.
      expect(titles(rank('road', source))).toEqual([
        'Road',
        'Roadmap Q3',
        'Off-road trip',
        'Weekly road plan',
        'Railroad',
      ]);
      expect(rank('road', source).map((item) => objectTier('road', item.title))).toEqual([0, 1, 2, 2, 3]);
    });

    it('matches nothing for a bare query, a query that no title contains, or an empty database', () => {
      const source = snapshot(rows('Road', 'Budget'));

      expect(rank('', source)).toEqual([]);
      expect(rank('   ', source)).toEqual([]);
      expect(rank('zebra', source)).toEqual([]);
      expect(rank('road', snapshot([]))).toEqual([]);
    });

    it('never lists an untitled row', () => {
      expect(rank('a', snapshot(rows('', '   ')))).toEqual([]);
    });

    it('gives each row the key and item of the server row, so the picker inserts the same mention', () => {
      const [row] = rows('Road trip');
      const [item] = rank('road', snapshot([row]));

      expect(item.key).toBe(`row:${DATABASE}:${row.rowId}`);
      expect(item.key).toBe(mentionLocalRowNavKey(DATABASE, row.rowId));
      expect(mentionItemNavKey(item.item)).toBe(item.key);
      expect(item.item).toEqual({
        kind: MentionTargetKind.DatabaseRow,
        object_id: row.rowId,
        title: 'Road trip',
        database_id: DATABASE,
        database_view_id: VIEW,
        database_row_id: row.rowId,
        mention: { type: 'databaseRow', database_id: DATABASE, database_view_id: VIEW, row_id: row.rowId },
      });
      expect(mentionSearchItemToMention(item.item)).toEqual({
        type: MentionType.PageRef,
        page_id: VIEW,
        block_id: row.rowId,
        database_id: DATABASE,
        database_view_id: VIEW,
        row_id: row.rowId,
        database_row_id: row.rowId,
        row_document_id: undefined,
        data: { title: 'Road trip', subtitle: undefined, icon: undefined },
      });
    });

    it('says whether the title follows a synced live document', () => {
      const ranked = rank(
        'road',
        snapshot([
          { rowId: rowId(1), title: 'Road', synced: true },
          { rowId: rowId(2), title: 'Road trip', synced: false },
          { rowId: rowId(3), title: 'Road planning' },
        ])
      );

      expect(ranked.map((item) => [item.title, item.synced])).toEqual([
        ['Road', true],
        ['Road trip', false],
        ['Road planning', false],
      ]);
    });

    it('carries the creation time as when the row changed, and no recency', () => {
      const [item] = rank('road', snapshot([{ rowId: rowId(1), title: 'Road', createdAtMs: NOW - MINUTE }]));

      expect(item.changedMs).toBe(NOW - MINUTE);
      expect(item.lastUsedMs).toBeUndefined();
      expect(item.present).toBeUndefined();
    });

    it('orders a tier by pick memory, and the exact input lifts a row one tier', () => {
      const source = snapshot(rows('Road', 'Roadmap', 'Off-road'));
      const roadmap = mentionLocalRowNavKey(DATABASE, rowId(2));
      const offRoad = mentionLocalRowNavKey(DATABASE, rowId(3));

      expect(titles(rank('road', source, { picks: new Map([[offRoad, { adaptive: 200_000, lift: false }]]) }))).toEqual([
        'Road',
        'Roadmap',
        'Off-road',
      ]);
      // A lift raises Off-road (T2) to T1, where its pick puts it before Roadmap.
      expect(titles(rank('road', source, { picks: new Map([[offRoad, { adaptive: 700_000, lift: true }]]) }))).toEqual([
        'Road',
        'Off-road',
        'Roadmap',
      ]);
      expect(titles(rank('road', source, { picks: new Map([[roadmap, { adaptive: 300_000, lift: true }]]) }))).toEqual([
        'Roadmap',
        'Road',
        'Off-road',
      ]);
    });

    it(`returns at most ${MENTION_LOCAL_ROWS_LIMIT} rows by default, the best ones`, () => {
      const many = Array.from({ length: 200 }, (_, index) => ({ rowId: rowId(index + 1), title: `Task ${index}` }));
      const ranked = rank('task', snapshot([{ rowId: rowId(999), title: 'Task' }, ...many]));

      expect(ranked).toHaveLength(MENTION_LOCAL_ROWS_LIMIT);
      expect(ranked[0].title).toBe('Task');
      expect(rank('task', snapshot(many), { limit: 3 })).toHaveLength(3);
      expect(rank('task', snapshot(many), { limit: 0 })).toEqual([]);
    });

    it('reads a renamed row by its new title', () => {
      const before: MentionLocalRow = { rowId: rowId(1), title: 'Road trip' };
      const after: MentionLocalRow = { rowId: rowId(1), title: 'Sea voyage' };

      expect(titles(rank('road', snapshot([before])))).toEqual(['Road trip']);
      expect(rank('road', snapshot([after]))).toEqual([]);
      expect(titles(rank('sea', snapshot([after])))).toEqual(['Sea voyage']);
    });

    it('never lists the row the editor is in, whose title holds the query while it is typed', () => {
      // A new row's title, typed `@tomorrow`: the title editor saved the query as the title, which
      // outranks the other row (both start a word with it, and it is shorter).
      const [own, other] = rows('@tomorrow', 'Plan for tomorrow');
      const source = snapshot([own, other]);

      expect(titles(rank('tomorrow', source))).toEqual(['@tomorrow', 'Plan for tomorrow']);
      expect(titles(rank('tomorrow', source, { contextRowId: own.rowId }))).toEqual(['Plan for tomorrow']);
      // Left out before the cut, so it takes none of the places the limit keeps.
      expect(titles(rank('tomorrow', source, { contextRowId: own.rowId, limit: 1 }))).toEqual(['Plan for tomorrow']);
      expect(rank('tomorrow', snapshot([own]), { contextRowId: own.rowId })).toEqual([]);
      // Another row id leaves every row in.
      expect(titles(rank('tomorrow', source, { contextRowId: rowId(99) }))).toEqual(['@tomorrow', 'Plan for tomorrow']);
    });
  });

  describe('the word filter', () => {
    // Titles and queries that exercise every tier and the normalizer: case, marks, CJK, punctuation,
    // several words, a long title past 512 code points, and queries of one code point.
    const corpus = [
      'Road trip',
      'road',
      'ROADMAP 2026',
      'Off-road plan',
      'Railroad crossing',
      'Café Society',
      'cafe',
      'Crème brûlée recipes',
      '设计评审',
      '产品设计 v2',
      'デザイン会議',
      '회의록',
      'Q3 — review',
      '--',
      'a.b.c',
      'Weekly sync: road & rail',
      'x'.repeat(600) + ' road',
      'Road ' + 'y'.repeat(600),
      '   ',
      'Ünïcödé Tëst',
    ];
    const queries = [
      'road',
      'ro',
      'r',
      'road trip',
      'trip road',
      'rd',
      'off road',
      'cafe',
      'café',
      'CREME',
      'brulee rec',
      '设计',
      '评审',
      'デザ',
      '회의',
      'q3 review',
      '—',
      '--',
      '.',
      'a.b',
      'sync rail',
      'unicode test',
      'tëst',
      'xxxx',
      'y',
      'nothing here',
    ];
    const source = snapshot(corpus.map((title, index) => ({ rowId: rowId(index + 1), title })));

    it('keeps no row for a bare query, and drops untitled rows for any query', () => {
      expect(mentionLocalRowCandidates(prepareMentionQuery(''), source.rows)).toEqual([]);
      expect(mentionLocalRowCandidates(prepareMentionQuery('   '), source.rows)).toEqual([]);
      queries.forEach((query) =>
        expect(mentionLocalRowCandidates(prepareMentionQuery(query), source.rows).map((row) => row.title)).not.toContain(
          '   '
        )
      );
    });

    it.each(queries)('drops only rows that cannot match %p', (query) => {
      const prepared = prepareMentionQuery(query);
      const kept = new Set(mentionLocalRowCandidates(prepared, source.rows).map((row) => row.rowId));

      source.rows.forEach((row) => {
        if (objectTier(prepared, row.title) !== undefined) expect(kept.has(row.rowId)).toBe(true);
      });
    });

    it.each(queries)('ranks %p as the contract ranks every row', (query) => {
      const everyRow = rankSection(
        prepareMentionQuery(query),
        'objects',
        source.rows.map((row) => ({ key: mentionLocalRowNavKey(DATABASE, row.rowId), title: row.title })),
        NOW,
        MENTION_LOCAL_ROWS_LIMIT
      );

      expect(rank(query, source).map((item) => item.key)).toEqual(everyRow.map((candidate) => candidate.key));
    });
  });

  describe('in the merge', () => {
    const request = { query: 'road', limit: 20 };
    const merged = (createdAtMs: number | undefined, server: MentionSearchSection[] = []) =>
      mergeMentionSections({
        request,
        server,
        local: rank('road', snapshot([{ rowId: rowId(1), title: 'Road trip', createdAtMs }])),
        nowMs: NOW,
      });

    it('joins Pages, where Search returns rows', () => {
      expect(merged(undefined).map((section) => [section.kind, section.items.map((item) => item.source)])).toEqual([
        [MentionSearchSectionKind.Pages, ['local']],
      ]);
    });

    it('is fresh when created at most 15 minutes ago, or at a time ahead of the clock', () => {
      const fresh = (createdAtMs: number | undefined) => merged(createdAtMs)[0].items[0].fresh;

      expect(fresh(NOW - 14 * MINUTE)).toBe(true);
      expect(fresh(NOW - 15 * MINUTE)).toBe(true);
      expect(fresh(NOW - 16 * MINUTE)).toBe(false);
      expect(fresh(NOW + MINUTE)).toBe(true);
      expect(fresh(undefined)).toBe(false);
    });

    it('keeps the server item of a row the server lists too, with the local title', () => {
      const serverRow = {
        ...mentionLocalRowItem(DATABASE, 'another-view', { rowId: rowId(1), title: 'Road trip (old)' }),
        row_document_id: 'row-doc',
      };
      const [section] = merged(NOW - MINUTE, [
        { kind: MentionSearchSectionKind.Pages, title: 'Pages', items: [serverRow], has_more: false, status: 'ok' },
      ]);

      expect(section.items).toHaveLength(1);
      expect(section.items[0]).toMatchObject({
        source: 'both',
        title: 'Road trip',
        fresh: false,
        serverItem: serverRow,
      });
    });
  });

  describe('mentionLocalRowsForSections', () => {
    const ranked = rank(
      'task',
      snapshot(Array.from({ length: 50 }, (_, index) => ({ rowId: rowId(index + 1), title: `Task ${index}` })))
    );
    const pages = (count: number): MentionSearchSection[] => [
      {
        kind: MentionSearchSectionKind.Pages,
        title: 'Pages',
        items: Array.from({ length: count }, (_, index) => ({
          kind: MentionTargetKind.Page,
          object_id: `page-${index}`,
          title: `Page ${index}`,
          mention: { type: MentionTargetKind.Page, page_id: `page-${index}` },
        })),
        has_more: false,
        status: 'ok',
      },
    ];

    it('keeps as many rows as Pages can hold: the limit, or what the server listed when more', () => {
      expect(mentionLocalRowsForSections(ranked, [], 20)).toEqual(ranked.slice(0, 20));
      expect(mentionLocalRowsForSections(ranked, pages(5), 20)).toEqual(ranked.slice(0, 20));
      expect(mentionLocalRowsForSections(ranked, pages(34), 20)).toEqual(ranked.slice(0, 34));
      expect(mentionLocalRowsForSections(ranked.slice(0, 3), pages(34), 20)).toEqual(ranked.slice(0, 3));
    });

    describe('a row the server lists too', () => {
      // Renamed elsewhere: the walk's seed still has the old title, Search has the new one.
      const seedRow: MentionLocalRow = { rowId: rowId(1), title: 'Budget review' };
      // Renamed in this tab: its synced live document has the new title, Search the old one.
      const liveRow: MentionLocalRow = { rowId: rowId(2), title: 'Budget plan 2027', synced: true };
      const lane = rank('budget', snapshot([seedRow, liveRow]));
      const serverRow = (row: MentionLocalRow, title: string) => ({
        ...mentionLocalRowItem(DATABASE, 'another-view', { rowId: row.rowId, title }),
        row_document_id: `doc-${row.rowId}`,
      });
      const server: MentionSearchSection[] = [
        {
          kind: MentionSearchSectionKind.Pages,
          title: 'Pages',
          items: [serverRow(seedRow, 'Budget review Q3'), serverRow(liveRow, 'Budget plan')],
          has_more: false,
          status: 'ok',
        },
      ];

      it('is left to the server when its title comes from a copy that may lag, and kept when synced', () => {
        expect(mentionLocalRowsForSections(lane, server, 20).map((item) => item.title)).toEqual(['Budget plan 2027']);
        // Not listed by the server: both join.
        expect(mentionLocalRowsForSections(lane, pages(3), 20)).toEqual(lane);
      });

      it("shows and inserts the server's newer title for a seed's row, the synced title for a live one", () => {
        const [section] = mergeMentionSections({
          request: { query: 'budget', limit: 20 },
          server,
          local: mentionLocalRowsForSections(lane, server, 20),
          nowMs: NOW,
        });
        const byKey = new Map(section.items.map((item) => [item.key, item]));

        expect(byKey.get(mentionLocalRowNavKey(DATABASE, seedRow.rowId))).toMatchObject({
          source: 'server',
          title: 'Budget review Q3',
        });
        expect(byKey.get(mentionLocalRowNavKey(DATABASE, liveRow.rowId))).toMatchObject({
          source: 'both',
          title: 'Budget plan 2027',
        });
        expect(section.items).toHaveLength(2);
      });
    });
  });
});
