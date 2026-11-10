import {
  isMentionPickKey,
  loadMentionPickMemory,
  MENTION_PICK_MAX_ENTRIES,
  MENTION_PICK_MAX_INPUT_CODE_POINTS,
  MENTION_PICK_MEMORY_DEFAULT,
  MENTION_PICK_MEMORY_OVERRIDE_KEY,
  MENTION_PICK_SCALE,
  MentionPickMemory,
  mentionPickMemoryStorageKey,
  readMentionPickMemoryEnabled,
  recordMentionPick,
  removeMentionPickMemoryForUser,
} from '../mentionPickMemory';

import { loadMentionParityFixture } from './mention-parity-helpers';

interface PickStep {
  t_ms: number;
  op: 'pick' | 'score' | 'use_count';
  input: string;
  key: string;
  adaptive?: number;
  lift?: boolean;
  use_count?: number | null;
}

interface PickCase {
  id: string;
  capacity?: number;
  steps: PickStep[];
}

const fixture = loadMentionParityFixture<{ version: number; about: string; cases: PickCase[] }>('pick-memory.json');

const DAY_MS = 86_400_000;
const PAGE = 'page:00000000-0000-4000-8000-0000000002a1';
const OTHER_PAGE = 'page:00000000-0000-4000-8000-0000000002a2';
const STORAGE_KEY = 'af.mention.pick-memory.v1:workspace-1:7';

/** The navigation key of page `n`, so a test can pick many distinct pages. */
function pageKey(n: number): string {
  return `page:00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

/**
 * Picks 1,001 distinct pages after `ro`, through `pick`: page 0 twice on day 0 (the oldest entry,
 * and the strongest), page 1 once on day 1 (one day of decay makes it the weakest), and pages 2 to
 * 1,000 once on day 2.
 */
function pickThousandAndOne(pick: (key: string, nowMs: number) => void) {
  pick(pageKey(0), 0);
  pick(pageKey(0), 0);
  pick(pageKey(1), DAY_MS);
  for (let n = 2; n <= 1_000; n += 1) pick(pageKey(n), 2 * DAY_MS);
}

/** What a memory answers to one step, in the fixture's terms. */
function answer(step: PickStep, score: (input: string, key: string, nowMs: number) => unknown) {
  return { step, answer: score(step.input, step.key, step.t_ms) };
}

describe('pick-memory.json', () => {
  it('has every case the contract names, each with steps', () => {
    expect(fixture.version).toBe(1);
    expect(fixture.cases.length).toBeGreaterThanOrEqual(14);
    fixture.cases.forEach((entry) => expect(entry.steps.length).toBeGreaterThan(0));
  });

  it.each(fixture.cases.map((entry) => [entry.id, entry] as const))('%s', (_, entry) => {
    const memory = new MentionPickMemory({ capacity: entry.capacity ?? MENTION_PICK_MAX_ENTRIES });

    entry.steps.forEach((step) => {
      switch (step.op) {
        case 'pick':
          memory.recordPick(step.input, step.key, step.t_ms);
          break;
        case 'score': {
          const expected = { adaptive: step.adaptive, lift: step.lift };

          expect(answer(step, (input, key, nowMs) => memory.score(input, key, nowMs))).toEqual({
            step,
            answer: expected,
          });
          // `scores` answers for every item at once, and leaves out the ones that score nothing.
          expect(
            answer(step, (input, key, nowMs) => memory.scores(input, nowMs).get(key) ?? { adaptive: 0, lift: false })
          ).toEqual({ step, answer: expected });
          break;
        }

        case 'use_count':
          expect(answer(step, (input, key, nowMs) => memory.useCount(input, key, nowMs))).toEqual({
            step,
            answer: step.use_count,
          });
          break;
      }
    });
  });

  // The picker's own memory: picks read and write localStorage, and each check reads it again.
  describe('through localStorage', () => {
    beforeEach(() => localStorage.clear());

    it.each(fixture.cases.filter((entry) => entry.capacity === undefined).map((entry) => [entry.id, entry] as const))(
      '%s',
      (_, entry) => {
        entry.steps.forEach((step) => {
          if (step.op === 'pick') {
            recordMentionPick(STORAGE_KEY, step.input, step.key, step.t_ms);
            return;
          }

          const memory = loadMentionPickMemory(STORAGE_KEY, step.t_ms);

          if (step.op === 'score') {
            expect(answer(step, (input, key, nowMs) => memory.score(input, key, nowMs))).toEqual({
              step,
              answer: { adaptive: step.adaptive, lift: step.lift },
            });
          } else {
            expect(answer(step, (input, key, nowMs) => memory.useCount(input, key, nowMs))).toEqual({
              step,
              answer: step.use_count,
            });
          }
        });
      }
    );
  });
});

describe('MentionPickMemory', () => {
  it('converges on ten uses and never overflows', () => {
    const memory = new MentionPickMemory();

    for (let pick = 0; pick < 500; pick += 1) memory.recordPick('road', PAGE, 0);

    const count = memory.useCount('road', PAGE, 0) ?? 0;

    expect(count).toBeLessThanOrEqual(10 * MENTION_PICK_SCALE);
    expect(count).toBeGreaterThan(9 * MENTION_PICK_SCALE);
    expect(memory.score('road', PAGE, 0)).toEqual({ adaptive: MENTION_PICK_SCALE, lift: true });
  });

  it('forgets after a long gap without counting every day', () => {
    const memory = new MentionPickMemory();

    memory.recordPick('road', PAGE, 0);
    expect(memory.useCount('road', PAGE, Number.MAX_SAFE_INTEGER)).toBeNull();
    expect(memory.score('road', PAGE, Number.MAX_SAFE_INTEGER)).toEqual({ adaptive: 0, lift: false });
    expect(memory.scores('road', Number.MAX_SAFE_INTEGER).size).toBe(0);
  });

  it('decays by whole days, rounding each day down', () => {
    const memory = new MentionPickMemory();

    memory.recordPick('road', PAGE, 0);
    // 0.975^10 is 0.77633...; floored each day it is 776 326.
    expect(memory.useCount('road', PAGE, 10 * DAY_MS)).toBe(776_326);
    expect(memory.useCount('road', PAGE, 10 * DAY_MS + DAY_MS - 1)).toBe(776_326);
  });

  it('normalizes inputs as the matcher does: per code point, with no final sigma', () => {
    const memory = new MentionPickMemory();

    memory.recordPick('  ΟΔΟΣ\u0085', PAGE, 0);
    expect(memory.useCount('οδοσ', PAGE, 0)).toBe(MENTION_PICK_SCALE);
    // Whole-string lowercasing would have stored the final sigma.
    expect(memory.useCount('οδος', PAGE, 0)).toBeNull();
    expect(memory.score('ΟΔ', PAGE, 0)).toEqual({ adaptive: 100_000, lift: false });
  });

  // The fixture has no case where an entry for a longer input reaches 0.6 on its own.
  it('lifts only through the entry for exactly the typed input, however strong a longer one is', () => {
    const memory = new MentionPickMemory();

    for (let pick = 0; pick < 10; pick += 1) memory.recordPick('roadmap', PAGE, 0);
    expect(memory.score('road', PAGE, 0)).toEqual({ adaptive: 651_321, lift: false });

    memory.recordPick('road', PAGE, 0);
    expect(memory.score('road', PAGE, 0)).toEqual({ adaptive: 651_321, lift: false });
    expect(Object.fromEntries(memory.scores('road', 0))).toEqual({ [PAGE]: { adaptive: 651_321, lift: false } });
    expect(memory.score('roadmap', PAGE, 0)).toEqual({ adaptive: 1_000_000, lift: true });
  });

  it('scores every item whose entries start with the typed input, and only those', () => {
    const memory = new MentionPickMemory();

    memory.recordPick('ro', PAGE, 0);
    memory.recordPick('road', OTHER_PAGE, 0);

    expect(Object.fromEntries(memory.scores('r', 0))).toEqual({
      [PAGE]: { adaptive: 100_000, lift: false },
      [OTHER_PAGE]: { adaptive: 100_000, lift: false },
    });
    expect(Object.fromEntries(memory.scores('ro', 0))).toEqual({
      [PAGE]: { adaptive: 200_000, lift: false },
      [OTHER_PAGE]: { adaptive: 100_000, lift: false },
    });
    expect(Object.fromEntries(memory.scores('roa', 0))).toEqual({ [OTHER_PAGE]: { adaptive: 100_000, lift: false } });
    expect(memory.scores('', 0).size).toBe(0);
  });

  it('forgets the smallest input by code point among equally weak and old entries', () => {
    // U+E000 sorts before U+1F600 by code point, after it by UTF-16 unit.
    const memory = new MentionPickMemory({ capacity: 2 });

    memory.recordPick('', PAGE, 0);
    memory.recordPick('\u{1f600}', PAGE, 0);
    memory.recordPick('spec', OTHER_PAGE, 0);

    expect(memory.size).toBe(2);
    expect(memory.useCount('', PAGE, 0)).toBeNull();
    expect(memory.useCount('\u{1f600}', PAGE, 0)).toBe(MENTION_PICK_SCALE);
    expect(memory.useCount('spec', OTHER_PAGE, 0)).toBe(MENTION_PICK_SCALE);
  });

  it('keeps 1,000 entries by default, and a full memory forgets its weakest one, not its oldest', () => {
    const memory = new MentionPickMemory();

    pickThousandAndOne((key, nowMs) => memory.recordPick('ro', key, nowMs));

    expect(memory.size).toBe(1_000);
    expect(memory.useCount('ro', pageKey(1), 2 * DAY_MS)).toBeNull();
    // 1.9 after two days of decay, each rounded down.
    expect(memory.useCount('ro', pageKey(0), 2 * DAY_MS)).toBe(1_806_187);
    expect(memory.useCount('ro', pageKey(2), 2 * DAY_MS)).toBe(MENTION_PICK_SCALE);
    expect(memory.useCount('ro', pageKey(1_000), 2 * DAY_MS)).toBe(MENTION_PICK_SCALE);
  });

  it('drops every forgotten entry when it is full, before it forgets a live one', () => {
    const memory = new MentionPickMemory({ capacity: 3 });

    memory.recordPick('plan', OTHER_PAGE, 0);
    memory.recordPick('spec', OTHER_PAGE, 0);
    memory.recordPick('road', PAGE, 100 * DAY_MS);
    // At day 100 both early entries are forgotten (0.975^100 is 0.079), and both go.
    memory.recordPick('note', PAGE, 100 * DAY_MS);

    expect(memory.size).toBe(2);
    expect(memory.useCount('road', PAGE, 100 * DAY_MS)).toBe(MENTION_PICK_SCALE);
    expect(memory.useCount('note', PAGE, 100 * DAY_MS)).toBe(MENTION_PICK_SCALE);
  });

  it('records nothing for a bare @ or past its input bound, counted in code points', () => {
    const memory = new MentionPickMemory({ maxInputCodePoints: 3 });

    expect(memory.recordPick(' 　 ', PAGE, 0)).toBe(false);
    expect(memory.recordPick('road', PAGE, 0)).toBe(false);
    // Three code points are six UTF-16 units.
    expect(memory.recordPick('\u{1f600}\u{1f600}\u{1f600}', PAGE, 0)).toBe(true);
    expect(memory.size).toBe(1);
  });
});

describe('mentionPickMemoryStorageKey', () => {
  it('keys a memory by workspace and uid, and keeps nothing while either is unknown', () => {
    expect(mentionPickMemoryStorageKey('workspace-1', '7')).toBe(STORAGE_KEY);
    expect(mentionPickMemoryStorageKey('workspace-1', 7)).toBe(STORAGE_KEY);
    expect(mentionPickMemoryStorageKey('workspace-1', undefined)).toBeNull();
    expect(mentionPickMemoryStorageKey(undefined, '7')).toBeNull();
    expect(mentionPickMemoryStorageKey('', '7')).toBeNull();
    expect(mentionPickMemoryStorageKey('a:b', '7')).toBeNull();
  });
});

describe('isMentionPickKey', () => {
  it.each([
    ['person:00000000-0000-4000-8000-000000000001', true],
    ['page:00000000-0000-4000-8000-000000000001', true],
    ['database:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002', true],
    ['database:00000000-0000-4000-8000-000000000001:-', true],
    ['row:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002', true],
    // Quick picks and links are keyed by their text, and a key built from a title is no id.
    ['date:Today', false],
    ['reminder:Reminder 1 week', false],
    ['link:https://appflowy.io', false],
    ['page:Roadmap', false],
    ['person:Annie Wang', false],
    ['database:-:-', false],
    ['row:-:00000000-0000-4000-8000-000000000002', false],
  ])('%s is recorded: %s', (key, recorded) => {
    expect(isMentionPickKey(key)).toBe(recorded);
  });
});

describe('the picker memory in localStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  afterEach(() => jest.restoreAllMocks());

  it('stores only normalized inputs, navigation keys, counts and times', () => {
    recordMentionPick(STORAGE_KEY, ' Ro ', PAGE, 1_000);
    recordMentionPick(STORAGE_KEY, 'RO', PAGE, 2_000);

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual({
      v: 1,
      e: [[PAGE, 'ro', 1_900_000, 2_000]],
    });
    expect(loadMentionPickMemory(STORAGE_KEY, 2_000).score('ro', PAGE, 2_000)).toEqual({
      adaptive: 380_000,
      lift: false,
    });
  });

  it('records no date, reminder, link or key built from a title, and no bare @', () => {
    recordMentionPick(STORAGE_KEY, 'tod', 'date:Today', 0);
    recordMentionPick(STORAGE_KEY, 'rem', 'reminder:Reminder 1 week', 0);
    recordMentionPick(STORAGE_KEY, 'app', 'link:https://appflowy.io', 0);
    recordMentionPick(STORAGE_KEY, 'road', 'page:Roadmap', 0);
    recordMentionPick(STORAGE_KEY, '', PAGE, 0);

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it(`records inputs of at most ${MENTION_PICK_MAX_INPUT_CODE_POINTS} code points, however many UTF-16 units`, () => {
    const emoji = (count: number) => '\u{1f600}'.repeat(count);
    const han = (count: number) => '路'.repeat(count);

    recordMentionPick(STORAGE_KEY, emoji(MENTION_PICK_MAX_INPUT_CODE_POINTS), PAGE, 0);
    recordMentionPick(STORAGE_KEY, emoji(MENTION_PICK_MAX_INPUT_CODE_POINTS + 1), PAGE, 0);
    recordMentionPick(STORAGE_KEY, han(MENTION_PICK_MAX_INPUT_CODE_POINTS), OTHER_PAGE, 0);
    recordMentionPick(STORAGE_KEY, han(MENTION_PICK_MAX_INPUT_CODE_POINTS + 1), OTHER_PAGE, 0);

    const memory = loadMentionPickMemory(STORAGE_KEY, 0);

    expect(memory.size).toBe(2);
    expect(memory.useCount(emoji(MENTION_PICK_MAX_INPUT_CODE_POINTS), PAGE, 0)).toBe(MENTION_PICK_SCALE);
    expect(memory.useCount(han(MENTION_PICK_MAX_INPUT_CODE_POINTS), OTHER_PAGE, 0)).toBe(MENTION_PICK_SCALE);
    // A longer typed input starts no stored one.
    expect(memory.score(emoji(MENTION_PICK_MAX_INPUT_CODE_POINTS + 1), PAGE, 0)).toEqual({ adaptive: 0, lift: false });
  });

  it('stores at most 1,000 entries, and a pick into a full memory drops the weakest one', () => {
    pickThousandAndOne((key, nowMs) => recordMentionPick(STORAGE_KEY, 'ro', key, nowMs));

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null').e as [string, string, number, number][];
    const keys = stored.map(([key]) => key);

    expect(stored).toHaveLength(1_000);
    expect(keys).not.toContain(pageKey(1));
    expect(keys).toEqual(expect.arrayContaining([pageKey(0), pageKey(2), pageKey(1_000)]));
    expect(loadMentionPickMemory(STORAGE_KEY, 2 * DAY_MS).size).toBe(1_000);
  });

  it('keeps a pick another tab recorded after this picker loaded the memory', () => {
    const before = loadMentionPickMemory(STORAGE_KEY, 0);

    recordMentionPick(STORAGE_KEY, 'road', PAGE, 0);
    recordMentionPick(STORAGE_KEY, 'plan', OTHER_PAGE, 0);

    const after = loadMentionPickMemory(STORAGE_KEY, 0);

    expect(before.size).toBe(0);
    expect(after.useCount('road', PAGE, 0)).toBe(MENTION_PICK_SCALE);
    expect(after.useCount('plan', OTHER_PAGE, 0)).toBe(MENTION_PICK_SCALE);
  });

  it('prunes forgotten entries when it writes', () => {
    recordMentionPick(STORAGE_KEY, 'road', PAGE, 0);
    recordMentionPick(STORAGE_KEY, 'plan', OTHER_PAGE, 100 * DAY_MS);

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null').e).toEqual([
      [OTHER_PAGE, 'plan', MENTION_PICK_SCALE, 100 * DAY_MS],
    ]);
  });

  it('keeps each workspace and user apart', () => {
    const other = mentionPickMemoryStorageKey('workspace-2', '7') ?? '';

    recordMentionPick(STORAGE_KEY, 'road', PAGE, 0);

    expect(loadMentionPickMemory(other, 0).size).toBe(0);
    expect(loadMentionPickMemory(mentionPickMemoryStorageKey('workspace-1', '8') ?? '', 0).size).toBe(0);
  });

  it.each([
    ['not JSON', '{'],
    ['another version', JSON.stringify({ v: 2, e: [[PAGE, 'road', MENTION_PICK_SCALE, 0]] })],
    ['no entry list', JSON.stringify({ v: 1, e: 'road' })],
    ['a list', JSON.stringify([[PAGE, 'road', MENTION_PICK_SCALE, 0]])],
  ])('drops a stored value it cannot read: %s', (_, raw) => {
    localStorage.setItem(STORAGE_KEY, raw);

    expect(loadMentionPickMemory(STORAGE_KEY, 0).size).toBe(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    recordMentionPick(STORAGE_KEY, 'road', PAGE, 0);
    expect(loadMentionPickMemory(STORAGE_KEY, 0).useCount('road', PAGE, 0)).toBe(MENTION_PICK_SCALE);
  });

  it('skips stored entries this memory could not have written', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        e: [
          [PAGE, 'road', 1_900_000, 0],
          ['page:Roadmap', 'road', MENTION_PICK_SCALE, 0],
          [OTHER_PAGE, '', MENTION_PICK_SCALE, 0],
          [OTHER_PAGE, 'r'.repeat(MENTION_PICK_MAX_INPUT_CODE_POINTS + 1), MENTION_PICK_SCALE, 0],
          [OTHER_PAGE, 'big', 10 * MENTION_PICK_SCALE + 1, 0],
          [OTHER_PAGE, 'small', MENTION_PICK_SCALE - 1, 0],
          [OTHER_PAGE, 'half', MENTION_PICK_SCALE + 0.5, 0],
          [OTHER_PAGE, 'when', MENTION_PICK_SCALE, 'now'],
          [OTHER_PAGE, 'plan', MENTION_PICK_SCALE, 0, 'extra'],
          // The first entry of a key and input wins.
          [PAGE, 'road', MENTION_PICK_SCALE, 0],
        ],
      })
    );

    const memory = loadMentionPickMemory(STORAGE_KEY, 0);

    expect(memory.size).toBe(1);
    expect(memory.useCount('road', PAGE, 0)).toBe(1_900_000);
  });

  describe('when storage throws', () => {
    it('reads an empty memory and keeps no pick when every read throws', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, e: [[PAGE, 'road', MENTION_PICK_SCALE, 0]] }));
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage denied');
      });
      const setItem = jest.spyOn(Storage.prototype, 'setItem');

      expect(loadMentionPickMemory(STORAGE_KEY, 0).size).toBe(0);
      expect(() => recordMentionPick(STORAGE_KEY, 'road', PAGE, 0)).not.toThrow();
      expect(setItem).not.toHaveBeenCalled();
      expect(readMentionPickMemoryEnabled()).toBe(MENTION_PICK_MEMORY_DEFAULT);
    });

    it('keeps the stored memory when a write throws', () => {
      recordMentionPick(STORAGE_KEY, 'road', PAGE, 0);
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });

      expect(() => recordMentionPick(STORAGE_KEY, 'plan', OTHER_PAGE, 0)).not.toThrow();
      jest.restoreAllMocks();
      expect(loadMentionPickMemory(STORAGE_KEY, 0).useCount('road', PAGE, 0)).toBe(MENTION_PICK_SCALE);
      expect(loadMentionPickMemory(STORAGE_KEY, 0).useCount('plan', OTHER_PAGE, 0)).toBeNull();
    });

    it('does nothing when the localStorage getter itself throws', () => {
      const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');

      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get: () => {
          throw new DOMException('denied', 'SecurityError');
        },
      });

      try {
        expect(loadMentionPickMemory(STORAGE_KEY, 0).size).toBe(0);
        expect(() => recordMentionPick(STORAGE_KEY, 'road', PAGE, 0)).not.toThrow();
        expect(() => removeMentionPickMemoryForUser('7')).not.toThrow();
        expect(readMentionPickMemoryEnabled()).toBe(MENTION_PICK_MEMORY_DEFAULT);
      } finally {
        if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
        else delete (window as { localStorage?: Storage }).localStorage;
      }

      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  it("removes every memory of one user on sign-out, and nobody else's", () => {
    const keep = [
      mentionPickMemoryStorageKey('workspace-1', '8'),
      mentionPickMemoryStorageKey('workspace-1', '77'),
      'af.dashboard.private.v1:workspace-1:7:dashboard',
      'unrelated:7',
    ];

    [STORAGE_KEY, mentionPickMemoryStorageKey('workspace-2', '7'), ...keep].forEach((key) =>
      localStorage.setItem(key ?? '', 'stored')
    );

    removeMentionPickMemoryForUser(7);

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(mentionPickMemoryStorageKey('workspace-2', '7') ?? '')).toBeNull();
    keep.forEach((key) => expect(localStorage.getItem(key ?? '')).toBe('stored'));

    removeMentionPickMemoryForUser(undefined);
    removeMentionPickMemoryForUser('');
    expect(localStorage.length).toBe(keep.length);
  });
});

describe('readMentionPickMemoryEnabled', () => {
  beforeEach(() => localStorage.clear());

  it('is off by default, and a browser can switch it either way', () => {
    expect(MENTION_PICK_MEMORY_DEFAULT).toBe(false);
    expect(readMentionPickMemoryEnabled()).toBe(false);

    localStorage.setItem(MENTION_PICK_MEMORY_OVERRIDE_KEY, 'true');
    expect(readMentionPickMemoryEnabled()).toBe(true);

    localStorage.setItem(MENTION_PICK_MEMORY_OVERRIDE_KEY, 'false');
    expect(readMentionPickMemoryEnabled()).toBe(false);

    localStorage.setItem(MENTION_PICK_MEMORY_OVERRIDE_KEY, 'yes');
    expect(readMentionPickMemoryEnabled()).toBe(MENTION_PICK_MEMORY_DEFAULT);
  });
});

describe('mentionPickMemory dependencies', () => {
  it('loads without React', () => {
    jest.isolateModules(() => {
      jest.doMock('react', () => {
        throw new Error('pick memory must not load React');
      });

      const pickMemory = require('../mentionPickMemory') as typeof import('../mentionPickMemory');
      const memory = new pickMemory.MentionPickMemory();

      memory.recordPick('road', PAGE, 0);
      expect(memory.useCount('road', PAGE, 0)).toBe(MENTION_PICK_SCALE);
    });
    jest.dontMock('react');
  });
});
