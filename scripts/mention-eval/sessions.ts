/**
 * The seeded session generator of the @-mention replay (MEN-X-07): one synthetic workspace (2,000
 * pages and databases, 200 people on one address domain) and 30 days of one user's opens,
 * creations and picks, each pick with the query typed before it. `run-eval.mjs` writes it to
 * `__fixtures__/mention-eval/sessions.json` and replays it; Desktop replays the same bytes.
 *
 * Two event lists, each replayed from an empty state over the same workspace:
 * - `events`, the user's behavior, drawn from the model below: what the gates grade;
 * - `probes`, seven picks of every title and person whose typed forms the catalog writes out (the
 *   Greek, Han, kana, Hangul, diacritic, emoji and blank-name traps) and of every title past 128
 *   code points, which the behavior rarely reaches, five of them the same day so the one-tier lift
 *   ranks: for the TypeScript/Dart parity check only, so they never weigh on the gates.
 *
 * Everything is a pure function of {@link MENTION_EVAL_PARAMS}: a 32-bit seeded generator
 * (mulberry32), integer weights and integer milliseconds, so every run, machine and Node version
 * writes the same bytes. No wall clock, no locale, no floating point.
 *
 * The parameters of the events were fixed before any ranker was replayed against them, and must not
 * be tuned to a result: the replay is a regression guard for the client rankers, not a measure of
 * their quality, which online session metrics decide. The probes, which no gate reads, got their
 * five same-day picks after the first replay showed that no case reached the one-tier lift.
 */
import {
  CREATED_FAMILIES,
  CREATED_MEETING_NOTES,
  DATABASE_BASES,
  DATABASE_TEAM_SEPARATOR,
  DATABASE_TEAMS,
  DOC_TYPES,
  FIRST_NAMES,
  FIXED_PAGES,
  FIXED_PEOPLE,
  LAST_NAMES,
  MEETING_NOTES,
  MentionEvalPersonEntry,
  MentionEvalTitle,
  PEOPLE_DOMAIN,
  PREEXISTING_DATABASES,
  PREEXISTING_MEETING_NOTES,
  QUALIFIERS,
  REQUESTER,
  TOPICS,
} from './catalog';

/** The version of `sessions.json`, `expected-rankings.json` and `verdict.json`. */
export const MENTION_EVAL_VERSION = 1;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** Zipf weights: `floor(2^24 / rank)`, so every total stays below 2^32. */
const ZIPF_SCALE = 16_777_216;

/** The generator's parameters, written into `sessions.json` as they are. */
export const MENTION_EVAL_PARAMS = {
  seed: 1_296_387_591,
  /** Monday 2026-10-05T00:00:00Z. */
  start_ms: 1_791_158_400_000,
  days: 30,
  /** Activity from 09:00 to 18:00 UTC, in minutes of the day. */
  active_minutes: [540, 1080],
  /** How much more likely an event falls on a workday than on a weekend day (days 5 and 6 of each week). */
  workday_weight: 6,
  weekend_weight: 1,
  views: 2000,
  /** Views created during the replay, the rest exist before it, created 1 to 400 days earlier. */
  created_views: 150,
  meeting_notes: PREEXISTING_MEETING_NOTES + CREATED_MEETING_NOTES,
  preexisting_databases: PREEXISTING_DATABASES,
  people: 200,
  domain: PEOPLE_DOMAIN,
  opens: 2400,
  picks: 600,
  /** One pick in two is of a person, the others of a page or database. */
  person_pick_one_in: 2,
  /** Opens and picks choose a view, and picks a person, by `floor(2^24 / rank)` over a seeded order. */
  zipf_exponent: 1,
  /** A view created during the replay is as popular as the view of this rank for this many days. */
  fresh_rank: 8,
  fresh_days: 2,
  /** A target's typed forms: the habitual one, then the others, chosen by these weights. */
  habit_weights: [7, 2, 1],
  preexisting_age_days: [1, 400],
  /**
   * Each probe target's picks, as `[ms after the first, form]`: its first form five times an hour
   * apart, so the fifth ranks with the one-tier lift that the fourth same-day pick earns, then its
   * second form two days later and its third an hour after that (cycling through fewer forms). Its
   * view is opened five minutes after the first pick, which falls on one of the first
   * `days - probe_last_day_margin` days.
   */
  probe_picks: [
    [0, 0],
    [3_600_000, 0],
    [7_200_000, 0],
    [10_800_000, 0],
    [14_400_000, 0],
    [172_800_000, 1],
    [176_400_000, 2],
  ],
  probe_open_after_ms: 300_000,
  probe_last_day_margin: 3,
  /** Titles longer than this many code points are probed. */
  probe_long_title_code_points: 128,
} as const;

export type MentionEvalParams = typeof MENTION_EVAL_PARAMS;

/** A page or database of the workspace. It exists from `created_ms` on. */
export interface MentionEvalView {
  readonly id: string;
  /** The navigation key: `page:<id>` or `database:<id>:<view id>`. */
  readonly key: string;
  readonly kind: 'page' | 'database';
  readonly title: string;
  readonly created_ms: number;
}

/** A workspace member; every one exists for the whole replay. */
export interface MentionEvalPerson {
  readonly id: string;
  /** `person:<id>`. */
  readonly key: string;
  /** Possibly blank (only White_Space): the picker then shows the address. */
  readonly name: string;
  readonly email: string;
}

/**
 * What the user did, at a time in epoch milliseconds: opened or created a view, or typed a query and
 * inserted a mention of a person or view. Times rise strictly through the file.
 */
export type MentionEvalEvent =
  | readonly [t_ms: number, type: 'open' | 'create', view: string]
  | readonly [t_ms: number, type: 'pick', target: string, typed: string];

export interface MentionEvalSessions {
  readonly version: number;
  readonly about: string;
  readonly generator: { readonly name: string; readonly params: Readonly<Record<string, unknown>> };
  readonly start_ms: number;
  readonly end_ms: number;
  /** The person who types every query: last in their class. */
  readonly requester: string;
  /** Pages and databases by creation time: the outline's insertion order. */
  readonly views: readonly MentionEvalView[];
  /** People in roster (join) order, the requester first. */
  readonly people: readonly MentionEvalPerson[];
  /** The user's behavior: what the gates grade. */
  readonly events: readonly MentionEvalEvent[];
  /** Opens and picks of the trap targets, replayed apart from an empty state: parity only. */
  readonly probes: readonly MentionEvalEvent[];
}

const ABOUT =
  'Synthetic @-mention sessions for the client ranker replay (MEN-X-07): one workspace and 30 days ' +
  'of one user. Generated by AppFlowy-Web scripts/mention-eval (run-eval.mjs --write); do not edit. ' +
  'See README.md.';

/**
 * mulberry32, a 32-bit generator with exact integer steps (`Math.imul`, unsigned shifts), so V8 and
 * any other engine draw the same numbers.
 */
export class MentionEvalRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** The next number in `[0, 2^32)`. */
  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;

    let t = this.state;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** A uniform integer in `[0, n)`, for `1 <= n <= 2^32`, without modulo bias. */
  below(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > 0x1_0000_0000) throw new Error(`below(${n})`);

    const limit = 0x1_0000_0000 - (0x1_0000_0000 % n);

    for (;;) {
      const draw = this.nextUint32();

      if (draw < limit) return draw % n;
    }
  }

  /** An index chosen with probability proportional to its integer weight. */
  weighted(weights: readonly number[]): number {
    let total = 0;

    weights.forEach((weight) => {
      if (!Number.isInteger(weight) || weight < 0) throw new Error(`weight ${weight}`);
      total += weight;
    });
    if (total < 1 || total > 0x1_0000_0000) throw new Error(`total weight ${total}`);

    let draw = this.below(total);

    for (let index = 0; index < weights.length; index += 1) {
      if (draw < weights[index]) return index;
      draw -= weights[index];
    }

    throw new Error('unreachable');
  }

  pick<T>(items: readonly T[]): T {
    return items[this.below(items.length)];
  }

  /** `items` in a uniformly random order (Fisher-Yates), as a new array. */
  shuffled<T>(items: readonly T[]): T[] {
    const copy = [...items];

    for (let index = copy.length - 1; index > 0; index -= 1) {
      const other = this.below(index + 1);

      [copy[index], copy[other]] = [copy[other], copy[index]];
    }

    return copy;
  }

  /** A random version 4 UUID, lowercase and hyphenated. */
  uuid(): string {
    const bytes: number[] = [];

    for (let index = 0; index < 16; index += 4) {
      const draw = this.nextUint32();

      bytes.push(draw >>> 24, (draw >>> 16) & 0xff, (draw >>> 8) & 0xff, draw & 0xff);
    }

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}

/** `floor(2^24 / rank)`: Zipf with exponent 1, in integers. */
export function mentionEvalZipfWeight(rank: number): number {
  return Math.floor(ZIPF_SCALE / rank);
}

/** Lowercases A to Z only: typed forms do not depend on any Unicode case table. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
}

function isAscii(text: string): boolean {
  return /^[\x20-\x7e]*$/.test(text);
}

/** Whether `text` holds a letter or digit outside ASCII: such a title needs its forms written out. */
function hasNonAsciiWordChar(text: string): boolean {
  return Array.from(text).some((char) => (char.codePointAt(0) ?? 0) > 0x7f && /[\p{L}\p{N}]/u.test(char));
}

/** Habits: up to three forms with the habit weights, the first habitual. */
interface Habits {
  readonly forms: readonly string[];
  readonly weights: readonly number[];
}

function habitsOf(forms: readonly string[]): Habits {
  const distinct = forms.filter((form, index) => forms.indexOf(form) === index).slice(0, 3);

  if (distinct.length === 0) throw new Error('a target without forms');
  return { forms: distinct, weights: MENTION_EVAL_PARAMS.habit_weights.slice(0, distinct.length) };
}

/** Draws up to three distinct forms without replacement, by weight; the same form twice adds up. */
function drawHabits(random: MentionEvalRandom, options: readonly (readonly [form: string, weight: number])[]): Habits {
  const merged: [string, number][] = [];

  options.forEach(([form, weight]) => {
    const existing = merged.find(([found]) => found === form);

    if (existing) existing[1] += weight;
    else merged.push([form, weight]);
  });

  const forms: string[] = [];

  while (forms.length < 3 && merged.length > 0) {
    const index = random.weighted(merged.map(([, weight]) => weight));

    forms.push(merged[index][0]);
    merged.splice(index, 1);
  }

  return habitsOf(forms);
}

/**
 * The forms a user types for an ASCII title (`typing` is the title as typed, ASCII-folded): a prefix
 * of 2 to 8 code points, the whole title when it is at most 32, a later word's first 2 to 5, a
 * first word's start and a later word's start, or 2 to 4 code points from inside a long word.
 */
function titleHabits(random: MentionEvalRandom, typing: string): Habits {
  const lower = asciiLower(typing);
  const codePoints = Array.from(lower);
  const options: [string, number][] = [];
  const prefix = codePoints.slice(0, Math.min(codePoints.length, 2 + random.below(7))).join('');

  if (isAscii(prefix) && /[a-z0-9]/.test(prefix)) options.push([prefix, 45]);
  if (isAscii(lower) && codePoints.length <= 32) options.push([lower, 30]);

  const words: string[] = lower.match(/[a-z0-9]+/g) ?? [];

  if (words.length >= 2) {
    const later = words[1 + random.below(words.length - 1)];

    options.push([later.slice(0, Math.min(later.length, 2 + random.below(4))), 15]);

    const other = words[1 + random.below(words.length - 1)];

    options.push([`${words[0].slice(0, 1 + random.below(4))} ${other.slice(0, 1 + random.below(3))}`, 10]);
  }

  const long = words.filter((word) => word.length >= 5);

  if (long.length > 0) {
    const word = random.pick(long);
    const start = 1 + random.below(word.length - 2);
    const length = 2 + random.below(Math.min(4, word.length - start) - 1);

    options.push([word.slice(start, start + length), 5]);
  }

  return drawHabits(random, options);
}

/** The forms a user types for a person: a first-name prefix, the first name, a last-name prefix, and so on. */
function personHabits(
  random: MentionEvalRandom,
  [firstName, firstAscii]: readonly [string, string],
  [, lastAscii]: readonly [string, string]
): Habits {
  const options: [string, number][] = [];

  if (firstAscii.length >= 3) options.push([firstAscii.slice(0, 2 + random.below(firstAscii.length - 2)), 35]);
  options.push([random.below(2) === 0 ? asciiLower(firstName) : firstAscii, 25]);
  options.push([lastAscii.slice(0, Math.min(lastAscii.length, 3 + random.below(3))), 15]);
  options.push([`${firstAscii} ${lastAscii.slice(0, 1)}`, 15]);
  options.push([`${firstAscii}.${lastAscii.slice(0, 1 + random.below(3))}`, 10]);
  return drawHabits(random, options);
}

/** A view before its creation time and identity are known. */
interface ViewSlot {
  kind: 'page' | 'database';
  title: string;
  habits: Habits;
  /** Its place in the seeded popularity order, from 1. */
  rank: number;
  createdMs: number;
  /** Created during the replay, so popular for `fresh_days` after `createdMs`. */
  created: boolean;
  /** For a slot created during the replay: an exact `Meeting notes` page, or a family draw. */
  meetingNotes: boolean;
  /** A trap target the probes pick: forms written out, or a title past 128 code points. */
  readonly probe: boolean;
  readonly uuids: readonly [string, string];
  id?: string;
}

interface PersonSlot {
  readonly name: string;
  readonly email: string;
  readonly habits: Habits;
  readonly key: string;
  /** A person whose forms the catalog writes out: the probes pick them. */
  readonly probe: boolean;
  id?: string;
}

function fixedHabits(random: MentionEvalRandom, [title, forms]: MentionEvalTitle): Habits {
  if (forms) return habitsOf(forms);
  if (hasNonAsciiWordChar(title)) throw new Error(`"${title}" needs its typed forms written out`);
  return titleHabits(random, title);
}

/** `YYYY-MM-DD` of day `day` of the replay. */
function dateOf(params: MentionEvalParams, day: number): string {
  return new Date(params.start_ms + day * DAY_MS).toISOString().slice(0, 10);
}

/** A family title for a view created on `day`, with the text a user types for it. */
function familyTitle(
  random: MentionEvalRandom,
  params: MentionEvalParams,
  pattern: string,
  day: number
): { title: string; typing: string; forms?: string[] } {
  if (pattern.startsWith('会议纪要')) {
    const title = `会议纪要 ${dateOf(params, day)}`;

    return { title, typing: title, forms: ['会议纪要', '会议纪要 2026', '会议'] };
  }

  let title = pattern;
  let typing = pattern;
  const replace = (token: string, shown: string, typed = shown) => {
    title = title.replace(token, shown);
    typing = typing.replace(token, typed);
  };

  if (pattern.includes('{date}')) replace('{date}', dateOf(params, day));
  if (pattern.includes('{topic}')) replace('{topic}', random.pick(TOPICS));
  if (pattern.includes('{doc}')) replace('{doc}', random.pick(DOC_TYPES));
  if (pattern.includes('{sprint}')) replace('{sprint}', String(40 + Math.floor(day / 7)));
  if (pattern.includes('{first}')) {
    const [name, ascii] = random.pick(FIRST_NAMES);

    replace('{first}', name, ascii);
  }

  if (pattern.includes('{full}')) {
    const [first, firstAscii] = random.pick(FIRST_NAMES);
    const [last, lastAscii] = random.pick(LAST_NAMES);

    replace('{full}', `${first} ${last}`, `${firstAscii} ${lastAscii}`);
  }

  return { title, typing };
}

/** The workspace's views before any time is drawn: the pre-existing ones, then the creation slots. */
function viewSlots(random: MentionEvalRandom, params: MentionEvalParams): ViewSlot[] {
  const slots: ViewSlot[] = [];
  const titles = new Set<string>();
  const add = (kind: 'page' | 'database', entry: MentionEvalTitle) => {
    titles.add(entry[0]);
    slots.push({
      kind,
      title: entry[0],
      habits: fixedHabits(random, entry),
      rank: 0,
      createdMs: 0,
      created: false,
      meetingNotes: false,
      probe: entry[1] !== undefined || Array.from(entry[0]).length > params.probe_long_title_code_points,
      uuids: [random.uuid(), random.uuid()],
    });
  };

  for (let index = 0; index < PREEXISTING_MEETING_NOTES; index += 1) add('page', [MEETING_NOTES]);
  FIXED_PAGES.forEach((entry) => add('page', entry));
  [1, 2, 3, 4, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 28].forEach((day) =>
    add('page', [`Meeting notes 2026-09-${String(day).padStart(2, '0')}`])
  );
  DATABASE_BASES.forEach((entry) => add('database', entry));

  // Team variants of the ASCII names only, so rules can derive their forms.
  const teamDatabases = random.shuffled(
    DATABASE_BASES.filter(([, forms]) => !forms).flatMap(([title]) =>
      DATABASE_TEAMS.map((team): MentionEvalTitle => [`${title}${DATABASE_TEAM_SEPARATOR}${team}`])
    )
  );

  teamDatabases
    .slice(0, params.preexisting_databases - DATABASE_BASES.length)
    .forEach((entry) => add('database', entry));

  const preexisting = params.views - params.created_views;
  const combinations = random.shuffled(TOPICS.flatMap((topic) => DOC_TYPES.map((doc) => `${topic} ${doc}`)));

  for (const combination of combinations) {
    if (slots.length >= preexisting) break;

    const title = `${combination}${random.pick(QUALIFIERS)}`;

    if (!titles.has(title)) add('page', [title]);
  }

  if (slots.length !== preexisting) throw new Error(`${slots.length} pre-existing views`);

  const [minAge, maxAge] = params.preexisting_age_days;

  slots.forEach((slot) => {
    const days = minAge + random.below(maxAge - minAge + 1);

    slot.createdMs = params.start_ms - days * DAY_MS - random.below(DAY_MS);
  });

  const meetingNotes = new Set(random.shuffled([...Array(params.created_views).keys()]).slice(0, CREATED_MEETING_NOTES));

  for (let index = 0; index < params.created_views; index += 1) {
    slots.push({
      kind: 'page',
      title: '',
      habits: { forms: [], weights: [] },
      rank: 0,
      createdMs: 0,
      created: true,
      meetingNotes: meetingNotes.has(index),
      probe: false,
      uuids: [random.uuid(), random.uuid()],
    });
  }

  random.shuffled([...slots.keys()]).forEach((slot, index) => {
    slots[slot].rank = index + 1;
  });
  return slots;
}

function personSlot(random: MentionEvalRandom, [name, local, forms]: MentionEvalPersonEntry): PersonSlot {
  return {
    name,
    email: `${local}@${PEOPLE_DOMAIN}`,
    habits: habitsOf(forms ?? [local]),
    key: `person:${random.uuid()}`,
    probe: forms !== undefined,
  };
}

/** The roster: the requester first, then everyone else in a seeded join order. */
function personSlots(random: MentionEvalRandom, params: MentionEvalParams): PersonSlot[] {
  const others = FIXED_PEOPLE.map((entry) => personSlot(random, entry));
  const locals = new Set([REQUESTER[1], ...FIXED_PEOPLE.map(([, local]) => local)]);
  const pairs = random.shuffled(FIRST_NAMES.flatMap((first) => LAST_NAMES.map((last) => [first, last] as const)));

  for (const [first, last] of pairs) {
    if (others.length >= params.people - 1) break;

    let local = `${first[1]}.${last[1]}`;

    for (let suffix = 2; locals.has(local); suffix += 1) local = `${first[1]}.${last[1]}${suffix}`;
    locals.add(local);
    others.push({
      name: `${first[0]} ${last[0]}`,
      email: `${local}@${PEOPLE_DOMAIN}`,
      habits: personHabits(random, first, last),
      key: `person:${random.uuid()}`,
      probe: false,
    });
  }

  return [personSlot(random, REQUESTER), ...random.shuffled(others)];
}

/** Event kinds in the order they take at one instant, before the times are made unique. */
const EVENT_ORDER = { create: 0, open: 1, pick: 2 } as const;

interface DrawnEvent {
  t: number;
  readonly type: keyof typeof EVENT_ORDER;
  readonly draw: number;
}

function drawTime(random: MentionEvalRandom, params: MentionEvalParams, dayWeights: readonly number[]): number {
  const day = random.weighted(dayWeights);
  const [from, to] = params.active_minutes;
  const minute = from + random.below(to - from);

  return params.start_ms + day * DAY_MS + minute * MINUTE_MS + random.below(MINUTE_MS);
}

/** Generates the sessions of {@link MENTION_EVAL_PARAMS} (see the module header). */
export function generateMentionEvalSessions(params: MentionEvalParams = MENTION_EVAL_PARAMS): MentionEvalSessions {
  const random = new MentionEvalRandom(params.seed);
  const views = viewSlots(random, params);
  const people = personSlots(random, params);
  const dayWeights = [...Array(params.days).keys()].map((day) =>
    day % 7 >= 5 ? params.weekend_weight : params.workday_weight
  );
  const drawn: DrawnEvent[] = [];
  const draw = (type: keyof typeof EVENT_ORDER, count: number) => {
    for (let index = 0; index < count; index += 1) {
      drawn.push({ t: drawTime(random, params, dayWeights), type, draw: drawn.length });
    }
  };

  draw('create', params.created_views);
  draw('open', params.opens);
  draw('pick', params.picks);
  drawn.sort((a, b) => a.t - b.t || EVENT_ORDER[a.type] - EVENT_ORDER[b.type] || a.draw - b.draw);
  // Unique, strictly rising times: a view created at `t` exists for every later event.
  drawn.forEach((event, index) => {
    if (index > 0 && event.t <= drawn[index - 1].t) event.t = drawn[index - 1].t + 1;
  });

  const creationSlots = views.filter((slot) => slot.created);
  const existing = views.filter((slot) => !slot.created);
  const familyWeights = CREATED_FAMILIES.map((_, index) => mentionEvalZipfWeight(index + 1));
  const freshWeight = mentionEvalZipfWeight(params.fresh_rank);
  const freshMs = params.fresh_days * DAY_MS;
  const otherPeople = people.slice(1);
  const popularity = random.shuffled([...otherPeople.keys()]);
  const personWeights: number[] = new Array(otherPeople.length).fill(0);

  popularity.forEach((person, index) => {
    personWeights[person] = mentionEvalZipfWeight(index + 1);
  });

  const viewWeight = (slot: ViewSlot, t: number) => {
    const weight = mentionEvalZipfWeight(slot.rank);

    return slot.created && t - slot.createdMs <= freshMs ? Math.max(weight, freshWeight) : weight;
  };

  const chooseView = (t: number) => existing[random.weighted(existing.map((slot) => viewWeight(slot, t)))];
  const chooseForm = (habits: Habits) => habits.forms[random.weighted(habits.weights)];
  const walked: WalkedEvent[] = [];
  let nextCreation = 0;

  drawn.forEach(({ t, type }) => {
    if (type === 'create') {
      const slot = creationSlots[nextCreation];
      const day = Math.floor((t - params.start_ms) / DAY_MS);

      nextCreation += 1;
      slot.createdMs = t;
      if (slot.meetingNotes) {
        slot.title = MEETING_NOTES;
        slot.habits = titleHabits(random, MEETING_NOTES);
      } else {
        const family = CREATED_FAMILIES[random.weighted(familyWeights)];
        const { title, typing, forms } = familyTitle(random, params, family.pattern, day);

        slot.kind = family.kind;
        slot.title = title;
        slot.habits = forms ? habitsOf(forms) : titleHabits(random, typing);
      }

      existing.push(slot);
      walked.push({ t, type, view: slot });
      return;
    }

    if (type === 'open') {
      walked.push({ t, type, view: chooseView(t) });
      return;
    }

    const target =
      random.below(params.person_pick_one_in) === 0 ? otherPeople[random.weighted(personWeights)] : chooseView(t);

    walked.push({ t, type, target, typed: chooseForm(target.habits) });
  });

  const probes = probeEvents(random, params, dayWeights, [
    ...views.filter((slot) => slot.probe),
    ...people.filter((person) => person.probe),
  ]);

  // Ids in the outline's insertion order: by creation time, then catalog order.
  views
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => a.slot.createdMs - b.slot.createdMs || a.index - b.index)
    .forEach(({ slot }, index) => {
      slot.id = `v${index}`;
    });
  people.forEach((person, index) => {
    person.id = `p${index}`;
  });

  const idOf = (target: ViewSlot | PersonSlot) => {
    if (!target.id) throw new Error('a target without an id');
    return target.id;
  };

  const keyOf = (slot: ViewSlot) =>
    slot.kind === 'page' ? `page:${slot.uuids[0]}` : `database:${slot.uuids[0]}:${slot.uuids[1]}`;
  const eventOf = (event: WalkedEvent): MentionEvalEvent =>
    event.type === 'pick'
      ? ([event.t, 'pick', idOf(event.target), event.typed] as const)
      : ([event.t, event.type, idOf(event.view)] as const);

  return {
    version: MENTION_EVAL_VERSION,
    about: ABOUT,
    generator: { name: 'appflowy-web/scripts/mention-eval', params },
    start_ms: params.start_ms,
    end_ms: params.start_ms + params.days * DAY_MS,
    requester: idOf(people[0]),
    views: [...views]
      .sort((a, b) => Number(idOf(a).slice(1)) - Number(idOf(b).slice(1)))
      .map((slot) => ({
        id: idOf(slot),
        key: keyOf(slot),
        kind: slot.kind,
        title: slot.title,
        created_ms: slot.createdMs,
      })),
    people: people.map((person) => ({ id: idOf(person), key: person.key, name: person.name, email: person.email })),
    events: walked.map(eventOf),
    probes: probes.map(eventOf),
  };
}

type WalkedEvent =
  | { t: number; type: 'open' | 'create'; view: ViewSlot }
  | { t: number; type: 'pick'; target: ViewSlot | PersonSlot; typed: string };

/**
 * The probes (see the module header): each target picked by `probe_picks` from a random time, and a
 * view opened five minutes after its first pick. Every probe target exists before the replay starts.
 */
function probeEvents(
  random: MentionEvalRandom,
  params: MentionEvalParams,
  dayWeights: readonly number[],
  targets: readonly (ViewSlot | PersonSlot)[]
): WalkedEvent[] {
  const firstDays = dayWeights.slice(0, params.days - params.probe_last_day_margin);
  const drawn: (WalkedEvent & { draw: number })[] = [];

  targets.forEach((target) => {
    const base = drawTime(random, params, firstDays);
    const { forms } = target.habits;

    params.probe_picks.forEach(([offset, form]) => {
      drawn.push({ t: base + offset, type: 'pick', target, typed: forms[form % forms.length], draw: drawn.length });
    });
    if ('kind' in target) {
      if (target.created) throw new Error(`probe target "${target.title}" is created during the replay`);
      drawn.push({ t: base + params.probe_open_after_ms, type: 'open', view: target, draw: drawn.length });
    }
  });
  drawn.sort((a, b) => a.t - b.t || EVENT_ORDER[a.type] - EVENT_ORDER[b.type] || a.draw - b.draw);
  drawn.forEach((event, index) => {
    if (index > 0 && event.t <= drawn[index - 1].t) event.t = drawn[index - 1].t + 1;
  });
  return drawn;
}

/**
 * `value` as JSON with every character above U+007E written as a `\u` escape, so the files are
 * ASCII and no editor can change a title's bytes.
 */
export function mentionEvalJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

/** The lines of a JSON array of `items`, one item a line, indented by `indent` spaces. */
export function mentionEvalJsonLines(items: readonly unknown[], indent: number): string[] {
  const pad = ' '.repeat(indent);

  return items.map((item, index) => `${pad}${mentionEvalJson(item)}${index < items.length - 1 ? ',' : ''}`);
}

/** `sessions.json`: two-space JSON, one view, person or event a line, ASCII only, ending in one newline. */
export function serializeMentionEvalSessions(sessions: MentionEvalSessions): string {
  return [
    '{',
    `  "version": ${sessions.version},`,
    `  "about": ${mentionEvalJson(sessions.about)},`,
    `  "generator": ${mentionEvalJson(sessions.generator)},`,
    `  "start_ms": ${sessions.start_ms},`,
    `  "end_ms": ${sessions.end_ms},`,
    `  "requester": ${mentionEvalJson(sessions.requester)},`,
    '  "views": [',
    ...mentionEvalJsonLines(sessions.views, 4),
    '  ],',
    '  "people": [',
    ...mentionEvalJsonLines(sessions.people, 4),
    '  ],',
    '  "events": [',
    ...mentionEvalJsonLines(sessions.events, 4),
    '  ],',
    '  "probes": [',
    ...mentionEvalJsonLines(sessions.probes, 4),
    '  ]',
    '}',
    '',
  ].join('\n');
}

function fail(message: string): never {
  throw new Error(`sessions.json: ${message}`);
}

/**
 * Checks one event list: strictly rising safe-integer times, events of known kinds naming known
 * targets, picks with a query and never of the requester, and a view opened or picked only once it
 * exists. Returns the views it creates, each at its own creation time.
 */
function checkEvents(
  sessions: MentionEvalSessions,
  list: 'events' | 'probes',
  views: ReadonlyMap<string, MentionEvalView>,
  people: ReadonlySet<string>
): Set<string> {
  const created = new Set<string>();
  let previous = Number.NEGATIVE_INFINITY;

  sessions[list].forEach((event, index) => {
    const [t, type, id] = event;
    const where = `${list}[${index}]`;

    if (!Number.isSafeInteger(t) || t <= previous) fail(`${where} at ${t} after ${previous}`);
    previous = t;
    if (type !== 'open' && type !== 'create' && type !== 'pick') fail(`${where} of type ${String(type)}`);
    if (event[1] === 'pick') {
      if (typeof event[3] !== 'string' || event[3] === '') fail(`${where} without a query`);
      if (id === sessions.requester) fail(`${where} picks the requester`);
      if (people.has(id)) return;
    }

    const view = views.get(id);

    if (!view) fail(`${where} names ${id}`);
    if (type === 'create') {
      if (list === 'probes' || view.created_ms !== t || created.has(id)) fail(`${where} creates ${id} at ${t}`);
      created.add(id);
    } else if (view.created_ms > t) {
      fail(`${where} names ${id} before it exists`);
    }
  });
  return created;
}

/**
 * Reads `sessions.json` and checks what the replay relies on: unique ids, views by creation time,
 * both event lists (see `checkEvents`), and a create event at each created view's time.
 */
export function parseMentionEvalSessions(text: string): MentionEvalSessions {
  const sessions = JSON.parse(text) as MentionEvalSessions;

  if (sessions.version !== MENTION_EVAL_VERSION) fail(`version ${String(sessions.version)}`);

  const views = new Map<string, MentionEvalView>();
  const people = new Set<string>();

  sessions.views.forEach((view, index) => {
    if (view.id !== `v${index}` || views.has(view.id)) fail(`view ${index} has id ${view.id}`);
    if (index > 0 && view.created_ms < sessions.views[index - 1].created_ms) fail(`${view.id} out of creation order`);
    if (view.kind !== 'page' && view.kind !== 'database') fail(`${view.id} kind ${String(view.kind)}`);
    views.set(view.id, view);
  });
  sessions.people.forEach((person, index) => {
    if (person.id !== `p${index}` || people.has(person.id)) fail(`person ${index} has id ${person.id}`);
    people.add(person.id);
  });
  if (!people.has(sessions.requester)) fail(`requester ${sessions.requester}`);

  const created = checkEvents(sessions, 'events', views, people);

  checkEvents(sessions, 'probes', views, people);
  views.forEach((view) => {
    if (view.created_ms >= sessions.start_ms && !created.has(view.id)) fail(`${view.id} has no create event`);
  });
  return sessions;
}
