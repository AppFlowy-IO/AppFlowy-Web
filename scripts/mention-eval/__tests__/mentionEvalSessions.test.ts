/**
 * @jest-environment node
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { MENTION_EVAL_FIXTURE_DIR, MENTION_EVAL_SESSIONS } from '../fixtures';
import {
  generateMentionEvalSessions,
  MENTION_EVAL_PARAMS,
  MentionEvalEvent,
  MentionEvalRandom,
  MentionEvalSessions,
  mentionEvalZipfWeight,
  parseMentionEvalSessions,
  serializeMentionEvalSessions,
} from '../sessions';

const ROOT = join(__dirname, '..', '..', '..');

/** mulberry32 as its author publishes it, returning floats in [0, 1). */
function publishedMulberry32(seed: number): () => number {
  let a = seed;

  return () => {
    let t = (a += 0x6d2b79f5);

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const codePoints = (text: string) => Array.from(text).length;

describe('mention eval random', () => {
  it.each([1, MENTION_EVAL_PARAMS.seed])('draws what the published mulberry32 draws for seed %d', (seed) => {
    const random = new MentionEvalRandom(seed);
    const reference = publishedMulberry32(seed);

    for (let draw = 0; draw < 1000; draw += 1) {
      expect(random.nextUint32()).toBe(reference() * 4294967296);
    }
  });

  it('draws integers in range, by weight, and permutations', () => {
    const random = new MentionEvalRandom(7);
    const seen = new Set<number>();

    for (let draw = 0; draw < 2000; draw += 1) {
      const value = random.below(7);

      expect(Number.isInteger(value) && value >= 0 && value < 7).toBe(true);
      seen.add(value);
      expect(random.weighted([0, 3, 0])).toBe(1);
    }

    expect(seen.size).toBe(7);
    expect(random.shuffled([...Array(50).keys()]).sort((a, b) => a - b)).toEqual([...Array(50).keys()]);
    expect(random.uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(() => random.weighted([0, 0])).toThrow();
    expect(() => random.below(0)).toThrow();
    expect(mentionEvalZipfWeight(1)).toBe(16_777_216);
    expect(mentionEvalZipfWeight(3)).toBe(5_592_405);
  });
});

describe('mention eval sessions', () => {
  const sessions = generateMentionEvalSessions();
  const text = serializeMentionEvalSessions(sessions);

  it('are the same bytes on every run, and the committed sessions.json', () => {
    expect(serializeMentionEvalSessions(generateMentionEvalSessions())).toBe(text);

    const committed = readFileSync(join(ROOT, MENTION_EVAL_FIXTURE_DIR, MENTION_EVAL_SESSIONS), 'utf8');

    if (committed !== text) {
      throw new Error('sessions.json is stale: run `node scripts/mention-eval/run-eval.mjs --write`');
    }
  });

  it('change with the seed', () => {
    const other = generateMentionEvalSessions({ ...MENTION_EVAL_PARAMS, seed: MENTION_EVAL_PARAMS.seed + 1 });

    expect(serializeMentionEvalSessions(other)).not.toBe(text);
  });

  it('record their parameters and are ASCII, LF and one view, person or event a line', () => {
    expect(sessions.generator.params).toEqual(MENTION_EVAL_PARAMS);
    expect(Array.from(text).every((char) => char === '\n' || (char >= ' ' && char <= '~'))).toBe(true);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.split('\n').length).toBe(
      sessions.views.length + sessions.people.length + sessions.events.length + sessions.probes.length + 17
    );
    expect(parseMentionEvalSessions(text)).toEqual(JSON.parse(JSON.stringify(sessions)));
  });

  it('hold the workspace the plan asks for', () => {
    const { views, people } = sessions;
    const titles = views.map((view) => view.title);
    const created = views.filter((view) => view.created_ms >= sessions.start_ms);

    expect(views.length).toBe(2000);
    expect(views.filter((view) => view.kind === 'database').length).toBe(185);
    expect(created.length).toBe(150);
    expect(titles.filter((title) => title === 'Meeting notes').length).toBe(30);
    expect(titles.filter((title) => codePoints(title) > 128).length).toBeGreaterThanOrEqual(6);
    expect(titles.filter((title) => codePoints(title) > 512).length).toBeGreaterThanOrEqual(3);
    expect(titles).toEqual(
      expect.arrayContaining(['ΟΔΟΣ 2026', 'Οδός Αθηνάς', '路线图', 'ロードマップ', '회의록', 'Café menu'])
    );
    expect(titles.some((title) => /\p{Extended_Pictographic}/u.test(title))).toBe(true);
    expect(new Set(views.map((view) => view.key)).size).toBe(2000);
    views.forEach((view) =>
      expect(view.key).toMatch(view.kind === 'page' ? /^page:[0-9a-f-]{36}$/ : /^database:[0-9a-f-]{36}:[0-9a-f-]{36}$/)
    );

    expect(people.length).toBe(200);
    expect(sessions.requester).toBe('p0');
    expect(people[0].name).toBe('Avery Quinn');
    expect(new Set(people.map((person) => person.email.split('@')[1]))).toEqual(new Set(['acme.example']));
    expect(new Set(people.map((person) => person.email)).size).toBe(200);
    expect(people.filter((person) => /^[\s\u3000]*$/.test(person.name)).length).toBe(4);
    expect(people.some((person) => /\p{Script=Han}/u.test(person.name))).toBe(true);
    expect(people.some((person) => /\p{Script=Hangul}/u.test(person.name))).toBe(true);
  });

  it('hold 30 days of opens, creations and picks, and seven probes of each trap target', () => {
    const count = (events: readonly MentionEvalEvent[], type: string) =>
      events.filter((event) => event[1] === type).length;
    const picks = sessions.events.filter((event) => event[1] === 'pick');
    const probeTargets = new Set(sessions.probes.filter((event) => event[1] === 'pick').map((event) => event[2]));

    expect([count(sessions.events, 'open'), count(sessions.events, 'create'), picks.length]).toEqual([2400, 150, 600]);
    expect(picks.filter((event) => event[2].startsWith('p')).length).toBeGreaterThan(250);
    expect(picks.filter((event) => event[2].startsWith('v')).length).toBeGreaterThan(250);
    expect(Math.max(...sessions.events.map((event) => event[0]))).toBeLessThan(sessions.end_ms);
    expect(Math.min(...sessions.events.map((event) => event[0]))).toBeGreaterThanOrEqual(sessions.start_ms);

    expect(probeTargets.size).toBe(107);
    expect(count(sessions.probes, 'pick')).toBe(7 * probeTargets.size);
    expect(count(sessions.probes, 'create')).toBe(0);
    // The Greek trap is typed both ways: capitals that fold to sigma, and a final sigma.
    expect(sessions.probes.some((event) => event[3] === 'ΟΔΟΣ')).toBe(true);
    expect(sessions.probes.some((event) => event[3] === 'οδος')).toBe(true);
    expect(Math.max(...sessions.probes.map((event) => event[0]))).toBeLessThan(sessions.end_ms);
  });
});

describe('mention eval sessions parser', () => {
  const sessions = generateMentionEvalSessions();
  const text = serializeMentionEvalSessions(sessions);
  const withEvents = (
    change: (events: MentionEvalEvent[]) => MentionEvalEvent[],
    list: 'events' | 'probes' = 'events'
  ) => JSON.stringify({ ...sessions, [list]: change([...sessions[list]]) } as MentionEvalSessions);
  const firstPick = sessions.events.findIndex((event) => event[1] === 'pick');
  const created = sessions.views.find((view) => view.created_ms >= sessions.start_ms);

  it('accepts the generated file', () => {
    expect(() => parseMentionEvalSessions(text)).not.toThrow();
  });

  it('refuses times that do not rise, picks of the requester, unknown targets and early picks', () => {
    expect(() => parseMentionEvalSessions(withEvents((events) => [events[1], events[0], ...events.slice(2)]))).toThrow(
      'after'
    );
    expect(() =>
      parseMentionEvalSessions(
        withEvents((events) =>
          events.map((event, index) => (index === firstPick ? [event[0], 'pick', 'p0', 'av'] : event))
        )
      )
    ).toThrow('requester');
    expect(() =>
      parseMentionEvalSessions(
        withEvents((events) =>
          events.map((event, index) => (index === firstPick ? [event[0], 'pick', 'v9999', 'x'] : event))
        )
      )
    ).toThrow('names v9999');
    expect(() =>
      parseMentionEvalSessions(
        withEvents((events) => [[sessions.start_ms - 1, 'pick', created?.id ?? '', 'x'], ...events])
      )
    ).toThrow('before it exists');
  });

  it('refuses a created view without its create event, and a creation in the probes', () => {
    expect(() =>
      parseMentionEvalSessions(
        withEvents((events) => events.filter((event) => !(event[1] === 'create' && event[2] === created?.id)))
      )
    ).toThrow();
    expect(() =>
      parseMentionEvalSessions(withEvents((probes) => [[sessions.start_ms - 5, 'create', 'v0'], ...probes], 'probes'))
    ).toThrow('creates');
  });
});
