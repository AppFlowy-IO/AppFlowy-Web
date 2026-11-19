import {
  MentionSearchResponse,
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
} from '@/application/types';

import {
  combineMentionLaneAnswers,
  MENTION_FRESH_MS,
  MentionLocalItem,
  MentionMergedSection,
  mentionMergedPickerSections,
  mentionNormalizedLimit,
  mergeMentionSections,
} from '../mentionLocalMerge';
import { MentionPickMemory } from '../mentionPickMemory';
import { MentionPickRequest } from '../mentionPickRanking';
import { mentionItemNavKey } from '../mentionUtils';

import { loadMentionParityFixture } from './mention-parity-helpers';

/** A `merge.json` local item; omitted fields take the fixture README's defaults. */
interface FixtureLocal {
  key: string;
  title: string;
  email?: string;
  icon?: { ty: string; value: string } | null;
  changed_ago_ms?: number;
  used_ago_ms?: number;
  present?: boolean;
}

interface FixtureItem {
  key: string;
  title: string;
  source: string;
  fresh: boolean;
  icon: { ty: string; value: string } | null;
}

interface FixtureSection {
  kind: string;
  status: string;
  message: string | null;
  items: FixtureItem[];
}

interface MergeCase {
  id: string;
  request: MentionPickRequest & { query: string; limit?: number };
  requester?: string | null;
  picks?: { ago_ms: number; input: string; key: string }[];
  local: FixtureLocal[];
  server: MentionSearchResponse;
  rows_server?: MentionSearchResponse;
  expected: FixtureSection[];
}

const merge = loadMentionParityFixture<{ now_ms: number; cases: MergeCase[] }>('merge.json');
const NOW = merge.now_ms;

function localItems(entry: MergeCase): MentionLocalItem<FixtureItem['icon']>[] {
  return entry.local.map((item) => ({
    key: item.key,
    title: item.title,
    email: item.email ?? '',
    icon: item.icon ?? null,
    changedMs: item.changed_ago_ms === undefined ? undefined : NOW - item.changed_ago_ms,
    lastUsedMs: item.used_ago_ms === undefined ? undefined : NOW - item.used_ago_ms,
    present: item.present ?? false,
  }));
}

function serverOf(entry: MergeCase): MentionSearchResponse {
  return entry.rows_server ? combineMentionLaneAnswers(entry.server, entry.rows_server) : entry.server;
}

function picksOf(entry: MergeCase) {
  const memory = new MentionPickMemory();

  (entry.picks ?? []).forEach((pick) => memory.recordPick(pick.input, pick.key, NOW - pick.ago_ms));
  return memory.scores(entry.request.query, NOW);
}

function view(sections: MentionMergedSection[]): FixtureSection[] {
  return sections.map((section) => ({
    kind: section.kind,
    status: section.status,
    message: section.message ?? null,
    items: section.items.map((item) => ({
      key: item.key,
      title: item.title,
      source: item.source,
      fresh: item.fresh,
      icon: (item.icon as FixtureItem['icon']) ?? null,
    })),
  }));
}

function mergeCase(entry: MergeCase, overrides: Partial<Parameters<typeof mergeMentionSections>[0]> = {}) {
  return mergeMentionSections({
    request: entry.request,
    server: serverOf(entry),
    local: localItems(entry),
    picks: picksOf(entry),
    requesterPersonId: entry.requester ?? undefined,
    nowMs: NOW,
    ...overrides,
  });
}

function page(id: string, title: string): MentionSearchResultItem {
  return { kind: MentionTargetKind.Page, object_id: id, title, mention: { type: MentionTargetKind.Page, page_id: id } };
}

function database(databaseId: string, viewId: string, title: string): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Database,
    object_id: databaseId,
    title,
    database_id: databaseId,
    database_view_id: viewId,
    mention: { type: MentionTargetKind.Database, database_id: databaseId, database_view_id: viewId },
  };
}

function section(kind: MentionSearchSectionKind, items: MentionSearchResultItem[], status = 'ok'): MentionSearchSection {
  return { kind, title: kind, items, has_more: false, status };
}

function local(key: string, title: string, fields: Partial<MentionLocalItem> = {}): MentionLocalItem {
  return { key, title, ...fields };
}

const keysOf = (sections: MentionMergedSection[]) =>
  sections.map((found) => [found.kind, found.items.map((item) => item.key)]);

describe('mentionLocalMerge (MEN-WEB-09)', () => {
  describe('mention-parity merge.json', () => {
    it('covers every case of the file', () => {
      expect(merge.cases.length).toBe(24);
      expect(new Set(merge.cases.map((entry) => entry.id)).size).toBe(merge.cases.length);
    });

    it.each(merge.cases.map((entry) => [entry.id, entry] as const))('%s', (_, entry) => {
      const merged = mergeCase(entry);

      expect(view(merged)).toEqual(entry.expected);

      // A merged item keeps its server payload, so it inserts what the server sent.
      merged.forEach((found) =>
        found.items.forEach((item) => {
          if (item.serverItem) expect(mentionItemNavKey(item.serverItem)).toBe(item.key);
        })
      );
    });

    it('passes every case whatever order the local items come in', () => {
      merge.cases.forEach((entry) => {
        const reversed = localItems(entry).reverse();

        expect(view(mergeCase(entry, { local: reversed }))).toEqual(entry.expected);
      });
    });
  });

  describe('combineMentionLaneAnswers', () => {
    const roadmap = page('p1', 'Roadmap');
    const row: MentionSearchResultItem = {
      kind: MentionTargetKind.DatabaseRow,
      object_id: 'r1',
      title: 'Road',
      database_id: 'd1',
      database_row_id: 'r1',
      mention: { type: MentionTargetKind.DatabaseRow, database_id: 'd1', row_id: 'r1' },
    };

    it('keeps the primary answer when the rows answer adds nothing, and copies its sections', () => {
      const primary = { sections: [section(MentionSearchSectionKind.Pages, [roadmap])] };
      const combined = combineMentionLaneAnswers(primary, { sections: [] });

      expect(combined).toEqual({ ...primary, partial: false });
      expect(combined.sections[0]).not.toBe(primary.sections[0]);
      expect(primary.sections[0].items).toEqual([roadmap]);
    });

    it('takes the primary message before the rows message, and has_more from either', () => {
      const primary = {
        sections: [{ ...section(MentionSearchSectionKind.Pages, [roadmap], 'partial'), message: 'primary' }],
      };
      const rows = {
        sections: [{ ...section(MentionSearchSectionKind.Pages, [row], 'ok'), message: 'rows', has_more: true }],
        partial: true,
      };
      const combined = combineMentionLaneAnswers(primary, rows);

      expect(combined.partial).toBe(true);
      expect(combined.sections).toEqual([
        { kind: 'pages', title: 'pages', items: [roadmap, row], has_more: true, status: 'partial', message: 'primary' },
      ]);
      expect(
        combineMentionLaneAnswers({ sections: [section(MentionSearchSectionKind.Pages, [])] }, rows).sections[0]
      ).toEqual(expect.objectContaining({ message: 'rows', status: 'ok' }));
    });
  });

  describe('options the picker uses', () => {
    const tasks = database('d1', 'v1', 'Tasks');
    const roadDatabase = database('d2', 'v2', 'Road tasks');

    it('keeps a section in the server order when `rank` says so, local-only items after it, ranked', () => {
      const server = [section(MentionSearchSectionKind.Databases, [tasks, roadDatabase])];
      const lane = [
        local('database:d3:v3', 'Road map'),
        local('database:d4:v4', 'Road'),
        local('database:d5:v5', 'Finance'),
      ];
      const ranked = mergeMentionSections({ request: { query: 'road' }, server, local: lane, nowMs: NOW });
      const kept = mergeMentionSections({
        request: { query: 'road' },
        server,
        local: lane,
        nowMs: NOW,
        rank: (kind) => kind !== MentionSearchSectionKind.Databases,
      });

      // The contract ranks Databases: the unmatched server item drops to T4.
      expect(keysOf(ranked)).toEqual([
        ['databases', ['database:d4:v4', 'database:d2:v2', 'database:d3:v3', 'database:d1:v1']],
      ]);
      // The picker keeps the server's order; local-only items follow, matched and ranked.
      expect(keysOf(kept)).toEqual([
        ['databases', ['database:d1:v1', 'database:d2:v2', 'database:d4:v4', 'database:d3:v3']],
      ]);
    });

    it('limits each section by what `limit` gives it, after ranking', () => {
      const pages = Array.from({ length: 25 }, (_, index) => page(`p${index}`, `Road ${index}`));
      const server = [section(MentionSearchSectionKind.Pages, pages)];
      const lane = [local('page:new', 'Road')];

      expect(
        mergeMentionSections({ request: { query: 'road' }, server, local: lane, nowMs: NOW })[0].items
      ).toHaveLength(8);

      const merged = mergeMentionSections({
        request: { query: 'road', limit: 20 },
        server,
        local: lane,
        nowMs: NOW,
        limit: (_, serverItems) => Math.max(20, serverItems),
      });

      expect(merged[0].items).toHaveLength(25);
      // The exact title ranks first; the worst server item makes room for it.
      expect(merged[0].items[0].key).toBe('page:new');
      expect(merged[0].items.map((item) => item.key)).not.toContain('page:p24');
    });

    it('reads a request limit as Cloud does', () => {
      expect([undefined, 0, -3, 1, 2.5, 20, 21, 1000].map(mentionNormalizedLimit)).toEqual([8, 8, 8, 1, 2, 20, 20, 20]);
    });

    it('ranks a present person first in their class, and a recent item first in its tier', () => {
      const anna = {
        kind: MentionTargetKind.Person,
        object_id: 'anna',
        title: 'Anna',
        subtitle: 'anna@appflowy.io',
        mention: { type: MentionTargetKind.Person, person_id: 'anna', person_name: 'Anna', page_id: '' },
      } as MentionSearchResultItem;
      const andy = {
        ...anna,
        object_id: 'andy',
        title: 'Andy',
        subtitle: 'andy@appflowy.io',
        mention: { ...anna.mention, person_id: 'andy' },
      } as MentionSearchResultItem;
      const people = mergeMentionSections({
        request: { query: 'an' },
        server: [section(MentionSearchSectionKind.People, [anna, andy])],
        local: [local('person:andy', 'Andy', { email: 'andy@appflowy.io', present: true })],
        nowMs: NOW,
      });

      expect(keysOf(people)).toEqual([['people', ['person:andy', 'person:anna']]]);

      const pages = mergeMentionSections({
        request: { query: 'road' },
        server: [section(MentionSearchSectionKind.Pages, [page('a', 'Roadmap'), page('b', 'Road trip')])],
        local: [local('page:b', 'Road trip', { lastUsedMs: NOW - 2_000 })],
        nowMs: NOW,
      });

      expect(keysOf(pages)).toEqual([['pages', ['page:b', 'page:a']]]);
    });

    it('flags only local-only items as fresh, up to the 15-minute bound', () => {
      const merged = mergeMentionSections({
        request: { query: 'zeb' },
        server: [section(MentionSearchSectionKind.Pages, [page('known', 'Zebra notes')])],
        local: [
          local('page:known', 'Zebra notes', { changedMs: NOW }),
          local('page:new', 'Zebra plan', { changedMs: NOW - MENTION_FRESH_MS }),
          local('page:old', 'Zebra archive', { changedMs: NOW - MENTION_FRESH_MS - 1 }),
        ],
        nowMs: NOW,
      });

      // One tier: the server's item first, then the local-only ones, the shorter title first.
      expect(merged[0].items.map((item) => [item.key, item.source, item.fresh])).toEqual([
        ['page:known', 'both', false],
        ['page:new', 'local', true],
        ['page:old', 'local', false],
      ]);
    });
  });

  describe('mentionMergedPickerSections', () => {
    it('shows the merged titles with the server payload, and lists local-only and fresh keys', () => {
      const roadmap = page('p1', 'Roadmap');
      // `Rust` has no item to insert, so the picker leaves it out.
      const merged = mergeMentionSections({
        request: { query: 'r' },
        server: [section(MentionSearchSectionKind.Pages, [roadmap])],
        local: [
          local('page:p1', 'Road map'),
          local('page:p3', 'Ruby', { changedMs: NOW, item: page('p3', 'stale title') }),
          local('page:p4', 'Rust'),
        ],
        nowMs: NOW,
      });
      const picker = mentionMergedPickerSections(merged, (kind) => `title:${kind}`);

      expect(picker.sections).toEqual([
        {
          kind: 'pages',
          title: 'pages',
          has_more: false,
          status: 'ok',
          message: undefined,
          items: [{ ...roadmap, title: 'Road map' }, { ...page('p3', 'Ruby') }],
        },
      ]);
      expect([...picker.localKeys]).toEqual(['page:p3']);
      expect([...picker.freshKeys]).toEqual(['page:p3']);
    });

    it('titles a section only local items fill', () => {
      const merged = mergeMentionSections({
        request: { query: 'road' },
        server: [],
        local: [local('page:p1', 'Road trip', { item: page('p1', 'Road trip') })],
        nowMs: NOW,
      });

      expect(mentionMergedPickerSections(merged, (kind) => `title:${kind}`).sections).toEqual([
        {
          kind: 'pages',
          title: 'title:pages',
          items: [page('p1', 'Road trip')],
          has_more: false,
          status: 'ok',
          message: undefined,
        },
      ]);
    });
  });
});
