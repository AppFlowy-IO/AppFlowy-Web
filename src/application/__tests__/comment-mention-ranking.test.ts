import {
  COMMENT_MENTION_LIMIT,
  COMMENT_MENTION_RANKING_DEFAULT,
  COMMENT_MENTION_RANKING_OVERRIDE_KEY,
  commentAuthorsByRecency,
  commentMentionSuggestions,
  inlineCommentMentionParticipants,
  legacyCommentMentionCandidates,
  rankCommentMentionCandidates,
  readCommentMentionRanking,
  rowCommentMentionParticipants,
} from '@/application/comment-mention-ranking';
import { InlineComment } from '@/application/inline-comment';
import { RowComment } from '@/application/row-comment.type';
import { MentionablePerson, MentionPersonRole } from '@/application/types';
import { loadMentionParityFixture } from '@/components/editor/components/panels/mention-panel/__tests__/mention-parity-helpers';
import { normalizeMentionText } from '@/utils/normalize-text';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const MINUTE = 60_000;

function personId(uid: number): string {
  return `00000000-0000-4000-8000-${String(uid).padStart(12, '0')}`;
}

/** A roster entry; `mentionedMinutesAgo` sets the requester's last mention of them. */
function person(uid: number, name: string, email: string, mentionedMinutesAgo?: number): MentionablePerson {
  return {
    uid: String(uid),
    person_id: personId(uid),
    name,
    email,
    role: MentionPersonRole.Member,
    avatar_url: null,
    cover_image_url: null,
    custom_image_url: null,
    description: null,
    invited: false,
    last_mentioned_at:
      mentionedMinutesAgo === undefined ? null : new Date(NOW - mentionedMinutesAgo * MINUTE).toISOString(),
  };
}

const names = (people: readonly MentionablePerson[]) => people.map((entry) => entry.name);

// The roster of Cloud's people-ranking tests (`mentions/people/ranking.rs`); uid 1 is the requester.
function cloudRoster(): MentionablePerson[] {
  return [
    person(1, 'Nathan Fu', 'nathan@appflowy.io'),
    person(2, 'Brian Chen', 'brian@appflowy.io', 43_200),
    person(3, 'Dana Andersen', 'dana@appflowy.io', 1_440),
    person(4, 'Annie Wang', 'annie@appflowy.io', 2_880),
    person(5, 'Andrew Lee', 'andrew@appflowy.io', 300),
    person(6, 'Anh Nguyen', 'anh.nguyen@appflowy.io', 10),
    person(7, 'Appleton Grey', 'grey@appflowy.io', 60),
    person(8, 'Ivan Petrov', 'ivan@appflowy.io'),
  ];
}

const anna = person(11, 'Anna Kim', 'anna@appflowy.io');
const joan = person(12, 'Joan Diaz', 'joan@appflowy.io');
// A shorter name than Joan's, so inside their class Brian comes first unless Joan takes part.
const brian = person(13, 'Brian Li', 'brian@appflowy.io');
const team = [joan, brian, anna];

describe('comment mention ranking settings', () => {
  afterEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
  });

  it('keeps the legacy order by default', () => {
    expect(COMMENT_MENTION_RANKING_DEFAULT).toBe('legacy');
    expect(readCommentMentionRanking()).toBe('legacy');
  });

  it('lets the browser pick either order, and ignores anything else', () => {
    window.localStorage.setItem(COMMENT_MENTION_RANKING_OVERRIDE_KEY, 'ranked');
    expect(readCommentMentionRanking()).toBe('ranked');
    window.localStorage.setItem(COMMENT_MENTION_RANKING_OVERRIDE_KEY, 'legacy');
    expect(readCommentMentionRanking()).toBe('legacy');
    window.localStorage.setItem(COMMENT_MENTION_RANKING_OVERRIDE_KEY, 'on');
    expect(readCommentMentionRanking()).toBe(COMMENT_MENTION_RANKING_DEFAULT);
  });

  it('falls back to the default when storage is denied', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readCommentMentionRanking()).toBe(COMMENT_MENTION_RANKING_DEFAULT);
  });
});

describe('comment mention ranking dependencies', () => {
  it('loads without React', () => {
    jest.isolateModules(() => {
      jest.doMock('react', () => {
        throw new Error('the comment ranking must not load React');
      });

      type Ranking = typeof import('@/application/comment-mention-ranking');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ranking = require('@/application/comment-mention-ranking') as Ranking;

      expect(ranking.rankCommentMentionCandidates({ query: 'an', people: team }).map((entry) => entry.name)).toEqual([
        'Anna Kim',
        'Brian Li',
        'Joan Diaz',
      ]);
    });
    jest.dontMock('react');
  });
});

describe('the legacy comment mention order', () => {
  it('lists everyone whose name or address contains the text, in roster order', () => {
    expect(names(legacyCommentMentionCandidates('an', team))).toEqual(['Joan Diaz', 'Brian Li', 'Anna Kim']);
    // A shared domain matches everyone, as it always has.
    expect(names(legacyCommentMentionCandidates('flow', team))).toEqual(['Joan Diaz', 'Brian Li', 'Anna Kim']);
    expect(names(legacyCommentMentionCandidates('', team))).toEqual(['Joan Diaz', 'Brian Li', 'Anna Kim']);
  });

  it('skips people without a person id and stops at eight', () => {
    const roster = Array.from({ length: 12 }, (_, index) => person(index + 1, `Ann ${index + 1}`, `a${index}@x.io`));

    roster[0] = { ...roster[0], person_id: '' };
    expect(names(legacyCommentMentionCandidates('ann', roster))).toEqual(names(roster.slice(1, 9)));
    expect(
      commentMentionSuggestions('legacy', { query: 'ann', people: roster, participantIds: [personId(12)] })
    ).toEqual(roster.slice(1, 9));
  });
});

describe('the ranked comment mention order', () => {
  const rank = (query: string, people: readonly MentionablePerson[], options = {}) =>
    names(rankCommentMentionCandidates({ query, people, ...options }));

  it("ranks '@an' Anna, a name-word prefix, above Joan, a substring", () => {
    expect(rank('an', team)).toEqual(['Anna Kim', 'Brian Li', 'Joan Diaz']);
    expect(names(commentMentionSuggestions('ranked', { query: 'an', people: team }))).toEqual(rank('an', team));
  });

  it("matches no one by the address domain alone, so 'flow' finds nobody", () => {
    expect(rank('flow', team)).toEqual([]);
    expect(rank('appflowy', team)).toEqual([]);
    expect(rank('@appflowy', team)).toEqual(['Anna Kim', 'Brian Li', 'Joan Diaz']);
    expect(rank('anna@appflowy.io', team)).toEqual(['Anna Kim']);
  });

  it('ranks a thread participant first within its class, never above a better class', () => {
    expect(rank('an', team, { participantIds: [joan.person_id] })).toEqual(['Anna Kim', 'Joan Diaz', 'Brian Li']);

    const anders = person(14, 'Anders Holm', 'anders@appflowy.io', 1);

    expect(rank('an', [...team, anders])).toEqual(['Anders Holm', 'Anna Kim', 'Brian Li', 'Joan Diaz']);
    expect(rank('an', [...team, anders], { participantIds: [anna.person_id] })).toEqual([
      'Anna Kim',
      'Anders Holm',
      'Brian Li',
      'Joan Diaz',
    ]);
  });

  it('orders participants by how recently they took part', () => {
    const roster = [anna, joan, brian];

    expect(rank('', roster, { participantIds: [brian.person_id, anna.person_id] })).toEqual([
      'Brian Li',
      'Anna Kim',
      'Joan Diaz',
    ]);
    expect(rank('', roster, { participantIds: [anna.person_id, brian.person_id] })).toEqual([
      'Anna Kim',
      'Brian Li',
      'Joan Diaz',
    ]);
  });

  it('ranks participants, then people on the page, then recent mentions, then names', () => {
    const mentioned = person(21, 'Mia Lane', 'mia@x.io', 1);
    const present = person(22, 'Pia Lane', 'pia@x.io', 600);
    const participant = person(23, 'Ria Lane', 'ria@x.io');
    const other = person(24, 'Aia Lane', 'aia@x.io');
    const roster = [other, mentioned, present, participant];
    const context = { participantIds: [participant.person_id], presentIds: [present.person_id] };

    expect(rank('lane', roster, context)).toEqual(['Ria Lane', 'Pia Lane', 'Mia Lane', 'Aia Lane']);
    expect(rank('', roster, context)).toEqual(['Ria Lane', 'Pia Lane', 'Mia Lane', 'Aia Lane']);
    expect(rank('lane', roster)).toEqual(['Mia Lane', 'Pia Lane', 'Aia Lane', 'Ria Lane']);
  });

  it('puts the requester last in their class, however involved, but above weaker classes', () => {
    const me = person(31, 'Anna Self', 'self@x.io', 1);
    const roster = [me, anna, joan];
    const context = { participantIds: [me.person_id], presentIds: [me.person_id], requesterId: me.person_id };

    expect(rank('an', roster, context)).toEqual(['Anna Kim', 'Anna Self', 'Joan Diaz']);
    expect(rank('', roster, context)).toEqual(['Anna Kim', 'Joan Diaz', 'Anna Self']);
    // The requester's uid names them too, as older row comments do.
    expect(rank('', roster, { requesterId: '31' })).toEqual(['Anna Kim', 'Joan Diaz', 'Anna Self']);
  });

  it('resolves legacy uid authors, ignores unknown ids and reads person ids in any case', () => {
    expect(rank('', team, { participantIds: ['12'] })).toEqual(['Joan Diaz', 'Anna Kim', 'Brian Li']);

    const zed = { ...person(15, 'Zed Park', 'zed@appflowy.io'), person_id: 'a318b9a0-6e2a-4c85-9638-16fd152af6e1' };

    expect(rank('', [...team, zed], { participantIds: [zed.person_id.toUpperCase()] })).toEqual([
      'Zed Park',
      'Anna Kim',
      'Brian Li',
      'Joan Diaz',
    ]);
    expect(rank('', team, { participantIds: ['nobody', '999', ''], presentIds: ['ghost'], requesterId: 'x' })).toEqual([
      'Anna Kim',
      'Brian Li',
      'Joan Diaz',
    ]);
  });

  it('counts the shorter name first on a typed query only', () => {
    const anz = person(41, 'Anz', 'z@x.io');
    const anabelle = person(42, 'Anabelle', 'b@x.io');

    expect(rank('an', [anabelle, anz])).toEqual(['Anz', 'Anabelle']);
    expect(rank('', [anz, anabelle])).toEqual(['Anabelle', 'Anz']);
  });

  it('breaks name ties by code point, never by locale, and then by person id', () => {
    const emile = person(51, 'Émile', 'e@x.io');
    const zoe = person(52, 'zoe', 'z@x.io');
    const samB = { ...person(54, 'Sam', 'sam2@x.io'), person_id: 'b0000000-0000-4000-8000-000000000000' };
    const samA = { ...person(53, 'Sam', 'sam1@x.io'), person_id: 'a0000000-0000-4000-8000-000000000000' };

    expect(rank('', [emile, zoe])).toEqual(['zoe', 'Émile']);
    expect(rankCommentMentionCandidates({ query: 'sam', people: [samB, samA] }).map((entry) => entry.email)).toEqual([
      'sam1@x.io',
      'sam2@x.io',
    ]);
  });

  it('ranks the whole roster before keeping eight, and lists each person once', () => {
    const roster = Array.from({ length: 30 }, (_, index) => person(100 + index, `Ann ${100 + index}`, `a${index}@x.io`));
    const last = roster[29];

    const ranked = rankCommentMentionCandidates({
      query: 'ann',
      people: [...roster, last],
      participantIds: [last.person_id],
    });

    expect(ranked).toHaveLength(COMMENT_MENTION_LIMIT);
    expect(ranked[0]).toBe(last);
    expect(new Set(ranked.map((entry) => entry.person_id)).size).toBe(COMMENT_MENTION_LIMIT);
    expect(rankCommentMentionCandidates({ query: 'ann', people: roster, limit: 3 })).toHaveLength(3);
  });

  it('never lists someone without a person id, and tolerates missing roster fields', () => {
    const broken = { ...person(61, 'Ann Broken', 'b@x.io'), person_id: '' };
    const partial = { ...person(62, 'Ann Partial', 'p@x.io'), last_mentioned_at: 'not a time' };
    const unnamed = { ...person(63, 'x', 'ann.unnamed@x.io'), name: undefined } as unknown as MentionablePerson;

    expect(rank('ann', [broken, partial, unnamed]).length).toBe(2);
    expect(rank('', [broken])).toEqual([]);
  });

  it("matches Cloud's typed people order when no one takes part or is present", () => {
    expect(rank('an', cloudRoster(), { requesterId: '1' })).toEqual([
      'Anh Nguyen',
      'Andrew Lee',
      'Dana Andersen',
      'Annie Wang',
      'Brian Chen',
      'Ivan Petrov',
      'Nathan Fu',
    ]);
    expect(rank('app', cloudRoster(), { requesterId: '1' })).toEqual(['Appleton Grey']);

    const joannas = Array.from({ length: 10 }, (_, index) =>
      person(10 + index, `Joanna ${10 + index}`, `joanna${10 + index}@appflowy.io`, 10 + index)
    );
    const ranked = rank('ann', [person(9, 'Ann Lee', 'ann@appflowy.io'), ...joannas], { requesterId: '9' });

    expect(ranked).toHaveLength(8);
    expect(ranked[0]).toBe('Ann Lee');
    expect(ranked.slice(1).every((name) => name.startsWith('Joanna'))).toBe(true);
  });

  it("matches Cloud's bare people order, a blank name sorting by its address", () => {
    const people = [
      person(1, 'Nathan Fu', 'nathan@appflowy.io'),
      person(2, 'zoe', 'zoe@appflowy.io'),
      person(3, '', 'aaron@appflowy.io'),
      person(4, 'Bob', 'bob@appflowy.io'),
      person(5, 'Eva', 'eva@appflowy.io', 5),
    ];

    expect(rank('', people, { requesterId: '1' })).toEqual(['Eva', '', 'Bob', 'zoe', 'Nathan Fu']);
    expect(rank(' 　', people, { requesterId: '1', limit: 2 })).toEqual(['Eva', '']);

    const neverMentioned = [
      person(2, 'dave', 'dave@appflowy.io'),
      person(3, 'Bob', 'bob@appflowy.io'),
      person(4, ' ', 'carol@appflowy.io'),
      person(5, 'adam', 'adam@appflowy.io'),
    ];

    expect(rankCommentMentionCandidates({ query: '', people: neverMentioned }).map((entry) => entry.email)).toEqual([
      'adam@appflowy.io',
      'bob@appflowy.io',
      'carol@appflowy.io',
      'dave@appflowy.io',
    ]);
  });
});

interface PeopleCase {
  id: string;
  query: string;
  name: string;
  email: string;
  class: 'C0' | 'C1' | 'C2' | 'C3' | null;
}

describe('mention-parity people.json through the comment pickers', () => {
  const cases = loadMentionParityFixture<{ cases: PeopleCase[] }>('people.json').cases;
  const casePerson = (entry: PeopleCase, index: number) => ({
    ...person(1000 + index, entry.name, entry.email),
    description: entry.id,
  });
  const typedCases = cases.filter((entry) => normalizeMentionText(entry.query) !== '');

  it('covers typed and bare vectors', () => {
    expect(typedCases.length).toBeGreaterThan(20);
    expect(cases.length - typedCases.length).toBeGreaterThan(0);
  });

  it.each(typedCases.map((entry) => [entry.id, entry] as const))(
    '%s: lists the person exactly when they match',
    (_, entry) => {
      const listed = rankCommentMentionCandidates({ query: entry.query, people: [casePerson(entry, 0)] });

      expect(listed).toHaveLength(entry.class === null ? 0 : 1);
    }
  );

  it('orders the people of each query by their class', () => {
    const queries = [...new Set(typedCases.map((entry) => entry.query))];

    for (const query of queries) {
      const group = typedCases.filter((entry) => entry.query === query);
      const roster = group.map(casePerson);
      const expected = group.filter((entry) => entry.class !== null).map((entry) => entry.class);
      const ranked = rankCommentMentionCandidates({ query, people: roster, limit: Number.POSITIVE_INFINITY });
      const classOf = (entry: MentionablePerson) => group.find((item) => item.id === entry.description)?.class;

      expect({ query, classes: ranked.map(classOf) }).toEqual({ query, classes: [...expected].sort() });
    }
  });

  it('lists everyone for a query that normalizes to nothing, a bare @', () => {
    const bare = cases.filter((entry) => normalizeMentionText(entry.query) === '');

    for (const entry of bare) {
      expect(rankCommentMentionCandidates({ query: entry.query, people: [casePerson(entry, 0)] })).toHaveLength(1);
    }
  });
});

describe('comment participants', () => {
  function rowComment(
    id: string,
    authorId: string,
    createdAt: number,
    parentCommentId: string | null = null
  ): RowComment {
    return {
      id,
      parentCommentId,
      content: id,
      authorId,
      createdAt,
      updatedAt: createdAt,
      isResolved: false,
      resolvedBy: null,
      resolvedAt: null,
      reactions: {},
      attachments: [],
    };
  }

  it('lists each author once, the most recent first, later entries winning ties', () => {
    const comments = [
      { author: 'a', at: 10 },
      { author: 'b', at: 30 },
      { author: 'c', at: 30 },
      { author: 'a', at: 40 },
      { author: null, at: 50 },
      { author: 'd', at: Number.NaN },
    ];

    expect(
      commentAuthorsByRecency(
        comments,
        (comment) => comment.author,
        (comment) => comment.at
      )
    ).toEqual(['a', 'c', 'b', 'd']);
  });

  it("gives a row reply the thread's authors first, and a new row comment every commenter", () => {
    const comments = [
      rowComment('c1', 'joan', 100),
      rowComment('r1', '7', 200, 'c1'),
      rowComment('c2', 'carol', 300),
      rowComment('r2', 'joan', 400, 'c2'),
    ];

    expect(rowCommentMentionParticipants(comments, 'c1')).toEqual(['7', 'joan', 'carol']);
    expect(rowCommentMentionParticipants(comments)).toEqual(['joan', 'carol', '7']);
    expect(rowCommentMentionParticipants(comments, null)).toEqual(['joan', 'carol', '7']);
    expect(rowCommentMentionParticipants([], 'c1')).toEqual([]);
  });

  it("lists a document thread's authors, the most recent first, without deleted entries", () => {
    const comment = (commentId: string, uuid: string | null, createdAt: string, isDeleted = false): InlineComment => ({
      user: uuid ? { uuid, name: uuid, avatarUrl: null } : null,
      commentId,
      viewId: 'view',
      blockId: null,
      content: commentId,
      replyCommentId: null,
      isResolved: false,
      isDeleted,
      canBeDeleted: true,
      createdAt,
      updatedAt: createdAt,
    });

    expect(
      inlineCommentMentionParticipants([
        comment('root', 'ada', '2026-11-10T10:00:00Z'),
        comment('reply-1', 'bob', '2026-11-10T10:05:00Z'),
        comment('reply-2', 'cy', '2026-11-10T10:10:00Z', true),
        comment('reply-3', null, '2026-11-10T10:15:00Z'),
        comment('reply-4', 'ada', 'not a time'),
      ])
    ).toEqual(['bob', 'ada']);
  });
});
