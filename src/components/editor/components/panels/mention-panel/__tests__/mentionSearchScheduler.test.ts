import { MentionTargetKind } from '@/application/types';
import { SERVER_INFO_LOADING, ServerInfoState } from '@/utils/server-info';

import { MENTION_BARE_DEADLINE_MS, MENTION_TYPED_DEADLINE_MS, mentionRequestLane } from '../mentionRequestLanes';
import {
  createMentionSearchScheduler,
  isMentionFeatureAdvertised,
  LEGACY_MENTION_TYPED_DEBOUNCE_MS,
  MENTION_FEATURE_SHORT_PREFIX_V1,
  MENTION_ONE_LETTER_LOCAL_OVERRIDE_KEY,
  MENTION_SCHEDULER_DEFAULT_MODE,
  MENTION_SCHEDULER_MODE_OVERRIDE_KEY,
  MENTION_SCHEDULER_TIMINGS,
  MentionScheduledSearch,
  MentionSchedulerClock,
  MentionSchedulerSettings,
  MentionSearchFlight,
  MentionSearchGroup,
  MentionSearchScheduler,
  mentionQueryStaysLocal,
  readMentionSchedulerSettings,
} from '../mentionSearchScheduler';
import { buildMentionSearchRequests } from '../mentionUtils';

import { loadMentionParityFixture } from './mention-parity-helpers';

type ScheduleEventKind = 'send' | 'complete' | 'abort' | 'timeout';

interface ScheduleEvent {
  t_ms: number;
  event: ScheduleEventKind;
  query: string;
  lanes: string[];
}

interface ScheduleKey {
  t_ms: number;
  query: string;
}

interface ScheduleCase {
  id: string;
  server_latency_ms: number;
  short_prefix_v1?: boolean;
  rows_lane?: boolean;
  keys: ScheduleKey[];
  events: ScheduleEvent[];
  requests: number;
  typed_groups: number;
}

interface ScheduleFixture {
  version: number;
  config: {
    idle_ms: number;
    trailing_ms: number;
    abort_after_ms: number;
    typed_deadline_ms: number;
    bare_deadline_ms: number;
    short_prefix_v1: boolean;
    rows_lane: boolean;
  };
  cases: ScheduleCase[];
}

interface RequestFixture {
  deadlines_ms: { typed: number; bare: number };
  short_prefix_feature: string;
  stays_local: { query: string; short_prefix_v1: boolean; local: boolean }[];
}

const schedule = loadMentionParityFixture<ScheduleFixture>('schedule.json');
const requests = loadMentionParityFixture<RequestFixture>('request.json');

// What happens at one instant, in the contract's order: answers and timeouts (the bare request's,
// then the typed group's), then keystrokes, then the scheduler's own decisions.
const BARE_END = 0;
const TYPED_END = 1;
const KEYSTROKE = 2;
const TIMER = 3;
// Far more than any case needs: a keystroke wakes the scheduler a few times at most.
const MAX_SIMULATION_STEPS = 10_000;

interface Entry {
  at: number;
  phase: number;
  seq: number;
  run: () => void;
  cancelled: boolean;
}

async function flushMicrotasks() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

/** Fake time: entries run in (time, phase, creation) order, each followed by its promise callbacks. */
class Simulation {
  time = 0;
  private seq = 0;
  private entries: Entry[] = [];
  readonly clock: MentionSchedulerClock = {
    now: () => this.time,
    setTimeout: (callback, ms) => this.at(this.time + ms, TIMER, callback),
    clearTimeout: (handle) => {
      (handle as Entry).cancelled = true;
    },
  };

  at(at: number, phase: number, run: () => void): Entry {
    const entry = { at, phase, seq: this.seq, run, cancelled: false };

    this.seq += 1;
    this.entries.push(entry);
    return entry;
  }

  /**
   * Runs everything due up to `until`, then sets the clock there. A scheduler that keeps waking
   * itself fails here instead of hanging the suite (Jest's timeout cannot fire between microtasks).
   */
  async run(until = Number.POSITIVE_INFINITY) {
    for (let steps = 0; ; steps += 1) {
      if (steps > MAX_SIMULATION_STEPS) throw new Error(`the schedule did not settle by ${this.time} ms`);

      this.entries = this.entries.filter((entry) => !entry.cancelled);

      const next = this.entries
        .filter((entry) => entry.at <= until)
        .sort((a, b) => a.at - b.at || a.phase - b.phase || a.seq - b.seq)[0];

      if (!next) break;

      this.entries = this.entries.filter((entry) => entry !== next);
      this.time = next.at;
      next.run();
      await flushMicrotasks();
    }

    if (Number.isFinite(until)) this.time = Math.max(this.time, until);
  }
}

interface FakeGroup extends MentionSearchGroup {
  readonly query: string;
  ended: boolean;
}

const WITH_ROWS = [
  MentionTargetKind.Person,
  MentionTargetKind.Page,
  MentionTargetKind.Database,
  MentionTargetKind.DatabaseRow,
  MentionTargetKind.Date,
  MentionTargetKind.Reminder,
  MentionTargetKind.ExternalLink,
];
const WITHOUT_ROWS = WITH_ROWS.filter((kind) => kind !== MentionTargetKind.DatabaseRow);

/**
 * A server that answers every request after `latencyMs`, with the client's deadlines, and the
 * picker that sends to it: every send, end and abort is recorded as `schedule.json` lists them. The
 * lanes are the ones the panel's own request builder and lane map give the query.
 */
class Picker {
  readonly events: ScheduleEvent[] = [];
  readonly joins: { query: string; group: FakeGroup }[] = [];
  readonly simulation = new Simulation();
  readonly scheduler: MentionSearchScheduler<FakeGroup>;
  private inFlightTyped = 0;
  maxTypedInFlight = 0;

  constructor(private readonly latencyMs: number, settings: MentionSchedulerSettings, private readonly rowsLane = true) {
    this.scheduler = createMentionSearchScheduler<FakeGroup>(settings, this.simulation.clock);
  }

  lanes(query: string) {
    return buildMentionSearchRequests({ query, limit: 20, include: this.rowsLane ? WITH_ROWS : WITHOUT_ROWS }).map(
      (request) => mentionRequestLane(request, false)
    );
  }

  search(query: string, { refresh = false, key = query } = {}): MentionScheduledSearch<FakeGroup> {
    const bare = !query.trim();

    return {
      key,
      bare,
      refresh,
      send: () => this.send(query, bare, refresh),
      join: (group) => this.joins.push({ query, group }),
    };
  }

  /** A keystroke that leaves `query` in the picker, as the panel hands it to the scheduler. */
  type(query: string) {
    const bare = !query.trim();

    if (!bare && this.scheduler.keepsLocal(query)) this.scheduler.input(null);
    else this.scheduler.input(this.search(query));
  }

  private send(query: string, bare: boolean, refresh: boolean): FakeGroup {
    const lanes = this.lanes(query);
    const { simulation, events } = this;
    const sentAt = simulation.time;
    const deadlineMs = bare ? MENTION_BARE_DEADLINE_MS : MENTION_TYPED_DEADLINE_MS;
    const timesOut = this.latencyMs >= deadlineMs;
    let resolveSettled: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });

    events.push({ t_ms: sentAt, event: 'send', query, lanes });
    if (!bare) this.typedStarted();

    const group: FakeGroup = {
      query,
      ended: false,
      settled,
      outlivesPicker: bare || refresh,
      abort: () => {
        if (group.ended) return;

        end.cancelled = true;
        finish('abort');
      },
    };
    const finish = (event: ScheduleEventKind) => {
      group.ended = true;
      events.push({ t_ms: simulation.time, event, query, lanes });
      if (!bare) this.inFlightTyped -= 1;
      resolveSettled();
    };
    const end = simulation.at(sentAt + (timesOut ? deadlineMs : this.latencyMs), bare ? BARE_END : TYPED_END, () =>
      finish(timesOut ? 'timeout' : 'complete')
    );

    return group;
  }

  private typedStarted() {
    this.inFlightTyped += 1;
    this.maxTypedInFlight = Math.max(this.maxTypedInFlight, this.inFlightTyped);
  }

  /** Types `keys` at their times and runs until nothing is left to happen. */
  async replay(keys: ScheduleKey[]) {
    keys.forEach(({ t_ms, query }) => this.simulation.at(t_ms, KEYSTROKE, () => this.type(query)));
    await this.simulation.run();
    return this.events;
  }
}

function contractSettings(shortPrefixV1: boolean): MentionSchedulerSettings {
  // The contract applies the one-letter rule until the server lists short_prefix_v1.
  return { mode: 'contract', oneLetterLocal: !shortPrefixV1 };
}

function typedGroups(events: ScheduleEvent[]) {
  return events.filter((event) => event.event === 'send' && event.query.trim() !== '').length;
}

function requestCount(events: ScheduleEvent[]) {
  return events.filter((event) => event.event === 'send').reduce((sum, event) => sum + event.lanes.length, 0);
}

describe('mention search scheduler', () => {
  describe('schedule.json', () => {
    it('runs on the contract timings and deadlines', () => {
      expect(schedule.version).toBe(1);
      expect(MENTION_SCHEDULER_TIMINGS).toEqual({
        idleMs: schedule.config.idle_ms,
        trailingMs: schedule.config.trailing_ms,
        abortAfterMs: schedule.config.abort_after_ms,
      });
      expect([MENTION_TYPED_DEADLINE_MS, MENTION_BARE_DEADLINE_MS]).toEqual([
        schedule.config.typed_deadline_ms,
        schedule.config.bare_deadline_ms,
      ]);
      expect([MENTION_TYPED_DEADLINE_MS, MENTION_BARE_DEADLINE_MS]).toEqual([
        requests.deadlines_ms.typed,
        requests.deadlines_ms.bare,
      ]);
      expect(MENTION_FEATURE_SHORT_PREFIX_V1).toBe(requests.short_prefix_feature);
    });

    it.each(schedule.cases.map((entry) => [entry.id, entry] as const))('%s', async (_id, entry) => {
      const shortPrefixV1 = entry.short_prefix_v1 ?? schedule.config.short_prefix_v1;
      const picker = new Picker(
        entry.server_latency_ms,
        contractSettings(shortPrefixV1),
        entry.rows_lane ?? schedule.config.rows_lane
      );
      const events = await picker.replay(entry.keys);

      expect(events).toEqual(entry.events);
      expect(requestCount(events)).toBe(entry.requests);
      expect(typedGroups(events)).toBe(entry.typed_groups);
      expect(picker.maxTypedInFlight).toBeLessThanOrEqual(1);
    });
  });

  describe('the plan vectors (MEN-WEB-05 "Done when")', () => {
    const road = (gapMs: number): ScheduleKey[] =>
      ['', 'r', 'ro', 'roa', 'road'].map((query, index) => ({ t_ms: index * gapMs, query }));

    it.each([false, true])(
      'sends at most 2 typed groups for @road at 40 ms per key against a 150 ms server (short_prefix_v1 %s)',
      async (shortPrefixV1) => {
        const picker = new Picker(150, contractSettings(shortPrefixV1));
        const events = await picker.replay(road(40));

        expect(typedGroups(events)).toBeLessThanOrEqual(2);
        // Only the last query is sent, at its trailing edge, whether or not `r` stays local.
        expect(events.filter((event) => event.event === 'send').map(({ t_ms, query }) => [t_ms, query])).toEqual([
          [0, ''],
          [260, 'road'],
        ]);
      }
    );

    it.each([
      [false, ['ro', 'roa', 'road']],
      [true, ['r', 'ro', 'roa', 'road']],
    ])(
      'sends one group per keystroke without delay at 250 ms per key (short_prefix_v1 %s)',
      async (shortPrefixV1, sent) => {
        const picker = new Picker(150, contractSettings(shortPrefixV1));
        const keys = road(250);
        const events = await picker.replay(keys);
        const typedSends = events.filter((event) => event.event === 'send' && event.query);

        expect(typedSends.map((event) => event.query)).toEqual(sent);
        typedSends.forEach((event) => {
          expect(event.t_ms).toBe(keys.find((key) => key.query === event.query)?.t_ms);
        });
      }
    );

    it('never has two typed groups in flight, and never aborts a bare request or resends what it aborted', async () => {
      const words = ['road', 'meeting notes', 'q3'];
      let runs = 0;

      for (const word of words) {
        const prefixes = Array.from({ length: Array.from(word).length }, (_, index) =>
          Array.from(word)
            .slice(0, index + 1)
            .join('')
        );
        // Typing the word, and typing it then backspacing over its last character.
        const backspaced = [...prefixes, ...prefixes.slice(-2, -1)];

        for (const typed of [prefixes, backspaced]) {
          for (const gap of [5, 40, 99, 100, 101, 150, 250, 399, 400, 650]) {
            for (const latency of [0, 20, 150, 399, 400, 600, 2_499, 2_500, 6_000]) {
              for (const shortPrefixV1 of [false, true]) {
                const keys = [
                  { t_ms: 0, query: '' },
                  ...typed.map((query, index) => ({ t_ms: gap * (index + 1), query })),
                ];
                const picker = new Picker(latency, contractSettings(shortPrefixV1));
                const events = await picker.replay(keys);
                const context = JSON.stringify({ word, typed, gap, latency, shortPrefixV1, events });
                let typedInFlight: string | undefined;
                let bareInFlight = false;
                let aborted: [number, string] | undefined;

                events.forEach((event) => {
                  const bare = event.query === '';

                  expect([context, bare, event.lanes.includes('bare')]).toEqual([context, bare, bare]);
                  if (bare) {
                    expect([context, event.event]).not.toEqual([context, 'abort']);
                    if (event.event === 'send') expect([context, bareInFlight]).toEqual([context, false]);
                    bareInFlight = event.event === 'send';
                    return;
                  }

                  if (event.event === 'send') {
                    expect([context, typedInFlight]).toEqual([context, undefined]);
                    expect([context, aborted]).not.toEqual([context, [event.t_ms, event.query]]);
                    typedInFlight = event.query;
                  } else {
                    expect([context, typedInFlight]).toEqual([context, event.query]);
                    if (event.event === 'abort') aborted = [event.t_ms, event.query];
                    typedInFlight = undefined;
                  }
                });

                // The newest query that is not local is the last one sent.
                const newest = typed[typed.length - 1];
                const lastSent = events.filter((event) => event.event === 'send' && event.query).pop()?.query;

                if (!mentionQueryStaysLocal(newest, shortPrefixV1)) {
                  expect([context, lastSent]).toEqual([context, newest]);
                }

                expect([context, typedInFlight, bareInFlight]).toEqual([context, undefined, false]);
                runs += 1;
              }
            }
          }
        }
      }

      expect(runs).toBe(3 * 2 * 10 * 9 * 2);
    });
  });

  describe('the contract scheduler', () => {
    it('sends only the newest of the queries queued behind a slow group', async () => {
      const picker = new Picker(300, contractSettings(true));
      const events = await picker.replay([
        { t_ms: 0, query: '' },
        { t_ms: 300, query: 'pl' },
        { t_ms: 320, query: 'pla' },
        { t_ms: 340, query: 'plan' },
        { t_ms: 360, query: 'plans' },
      ]);

      expect(events.filter((event) => event.event === 'send').map(({ t_ms, query }) => [t_ms, query])).toEqual([
        [0, ''],
        [300, 'pl'],
        [600, 'plans'],
      ]);
    });

    it('aborts a group in flight only once it is 400 ms old', async () => {
      const picker = new Picker(1_000, contractSettings(true));

      picker.simulation.at(0, KEYSTROKE, () => picker.type('ro'));
      picker.simulation.at(150, KEYSTROKE, () => picker.type('roa'));
      await picker.simulation.run(399);
      expect(picker.events.map(({ event, query }) => [event, query])).toEqual([['send', 'ro']]);

      await picker.simulation.run(400);
      expect(picker.events.map(({ t_ms, event, query }) => [t_ms, event, query])).toEqual([
        [0, 'send', 'ro'],
        [400, 'abort', 'ro'],
        [400, 'send', 'roa'],
      ]);
    });

    it('lets a younger group finish and then sends the query that waited for it', async () => {
      const picker = new Picker(200, contractSettings(true));
      const events = await picker.replay([
        { t_ms: 0, query: 'ro' },
        { t_ms: 50, query: 'roa' },
      ]);

      expect(events.map(({ t_ms, event, query }) => [t_ms, event, query])).toEqual([
        [0, 'send', 'ro'],
        [200, 'complete', 'ro'],
        [200, 'send', 'roa'],
        [400, 'complete', 'roa'],
      ]);
    });

    it('lets a keystroke at the instant a group ends replace the queued query before it is sent', async () => {
      const picker = new Picker(200, contractSettings(true));
      // `r` ends at 300, the instant `roa` is typed: the contract answers first, then keystrokes,
      // then decides, so `ro`, queued until then, is never sent.
      const events = await picker.replay([
        { t_ms: 100, query: 'r' },
        { t_ms: 200, query: 'ro' },
        { t_ms: 300, query: 'roa' },
      ]);

      expect(events.map(({ t_ms, event, query }) => [t_ms, event, query])).toEqual([
        [100, 'send', 'r'],
        [300, 'complete', 'r'],
        [300, 'send', 'roa'],
        [500, 'complete', 'roa'],
      ]);
    });

    it.each([
      [100, 100],
      [99, 199],
    ])('counts a keystroke %i ms after the previous one as idle only from 100 ms', async (gapMs, sentAtMs) => {
      const picker = new Picker(50, contractSettings(true));
      const events = await picker.replay([
        { t_ms: 0, query: '' },
        { t_ms: gapMs, query: 'ro' },
      ]);

      expect(events.filter((event) => event.event === 'send').map(({ t_ms, query }) => [t_ms, query])).toEqual([
        [0, ''],
        [sentAtMs, 'ro'],
      ]);
    });

    it('drops the queued query when the user backspaces to the trigger', async () => {
      const picker = new Picker(50, contractSettings(false));
      const events = await picker.replay([
        { t_ms: 0, query: '' },
        { t_ms: 300, query: 'ro' },
        { t_ms: 320, query: 'roa' },
        { t_ms: 340, query: '' },
      ]);

      expect(typedGroups(events)).toBe(1);
      expect(events.filter((event) => event.query === 'roa')).toEqual([]);
      // The bare request of the opening had answered, so the trigger sends another.
      expect(events.filter((event) => event.event === 'send').map(({ t_ms, query }) => [t_ms, query])).toEqual([
        [0, ''],
        [300, 'ro'],
        [340, ''],
      ]);
    });

    it.each([
      ['a one-letter query kept local', 'r', contractSettings(false)],
      ['a query answered without a request', null, contractSettings(true)],
    ])('drops the queued query on %s', async (_name, query, settings) => {
      const picker = new Picker(1_000, settings);

      picker.simulation.at(0, KEYSTROKE, () => picker.type(''));
      picker.simulation.at(300, KEYSTROKE, () => picker.type('ro'));
      picker.simulation.at(350, KEYSTROKE, () => picker.type('roa'));
      picker.simulation.at(400, KEYSTROKE, () => (query ? picker.type(query) : picker.scheduler.input(null)));
      await picker.simulation.run();

      expect(picker.events.filter((event) => event.event === 'send').map(({ query: sent }) => sent)).toEqual(['', 'ro']);
    });

    it('hands a ready query the group in flight that asks the same, and joins the bare request in flight', async () => {
      const picker = new Picker(600, contractSettings(true));

      // `ro` is ready again at 500, while it is in flight; the trigger comes back at 550, while the
      // bare request is.
      await picker.replay([
        { t_ms: 0, query: '' },
        { t_ms: 300, query: 'ro' },
        { t_ms: 350, query: 'roa' },
        { t_ms: 400, query: 'ro' },
        { t_ms: 550, query: '' },
      ]);

      expect(picker.events.filter((event) => event.event === 'send').map(({ query }) => query)).toEqual(['', 'ro']);
      expect(picker.joins.map(({ query, group }) => [query, group.query])).toEqual([
        ['ro', 'ro'],
        ['', ''],
      ]);
    });

    it('compares queries by key, so a search for the same key joins the group in flight', async () => {
      const picker = new Picker(600, contractSettings(true));

      picker.simulation.at(0, KEYSTROKE, () => picker.scheduler.input(picker.search('Road', { key: 'road' })));
      picker.simulation.at(150, KEYSTROKE, () => picker.scheduler.input(picker.search('road', { key: 'road' })));
      await picker.simulation.run();

      expect(picker.events.filter((event) => event.event === 'send').map(({ query }) => query)).toEqual(['Road']);
      expect(picker.joins.map(({ query }) => query)).toEqual(['road']);
    });

    it('sends nothing for a search that needs nothing any more, and keeps nothing in flight for it', async () => {
      const picker = new Picker(300, contractSettings(true));
      const served: MentionScheduledSearch<FakeGroup> = { ...picker.search('ro'), send: () => null };

      picker.simulation.at(0, KEYSTROKE, () => picker.scheduler.input(served));
      picker.simulation.at(150, KEYSTROKE, () => picker.type('roa'));
      await picker.simulation.run();

      // Nothing was in flight, so `roa` went out at its keystroke.
      expect(picker.events.map(({ t_ms, event, query }) => [t_ms, event, query])).toEqual([
        [150, 'send', 'roa'],
        [450, 'complete', 'roa'],
      ]);
    });

    it('resubmits at once without counting a keystroke', async () => {
      const picker = new Picker(10, contractSettings(true));

      picker.simulation.at(0, KEYSTROKE, () => picker.type(''));
      picker.simulation.at(50, KEYSTROKE, () => picker.scheduler.resubmit(picker.search('roa')));
      // 120 ms after the trigger, the last keystroke: idle, so sent at once.
      picker.simulation.at(120, KEYSTROKE, () => picker.type('road'));
      await picker.simulation.run();

      expect(picker.events.filter((event) => event.event === 'send').map(({ t_ms, query }) => [t_ms, query])).toEqual([
        [0, ''],
        [50, 'roa'],
        [120, 'road'],
      ]);
    });

    it('still sends a resubmitted search only once the typed group in flight ends', async () => {
      const picker = new Picker(300, contractSettings(true));

      picker.simulation.at(0, KEYSTROKE, () => picker.type('ro'));
      picker.simulation.at(50, KEYSTROKE, () => picker.scheduler.resubmit(picker.search('roa')));
      await picker.simulation.run();

      expect(picker.events.filter((event) => event.event === 'send').map(({ t_ms, query }) => [t_ms, query])).toEqual([
        [0, 'ro'],
        [300, 'roa'],
      ]);
    });

    it('drops only its own queued search when one is withdrawn', async () => {
      const picker = new Picker(300, contractSettings(true));
      const first = picker.search('ro');
      const second = picker.search('roa');

      picker.simulation.at(0, KEYSTROKE, () => picker.type(''));
      picker.simulation.at(20, KEYSTROKE, () => picker.scheduler.input(first));
      picker.simulation.at(40, KEYSTROKE, () => {
        picker.scheduler.withdraw(first);
        picker.scheduler.input(second);
        // `first` no longer waits, so withdrawing it again leaves `second` queued.
        picker.scheduler.withdraw(first);
      });
      await picker.simulation.run();

      expect(picker.events.filter((event) => event.event === 'send').map(({ t_ms, query }) => [t_ms, query])).toEqual([
        [0, ''],
        [140, 'roa'],
      ]);
    });

    it('aborts the typed search in flight when the panel closes, but not a refresh or the bare request', async () => {
      const picker = new Picker(1_000, contractSettings(true));

      picker.simulation.at(0, KEYSTROKE, () => picker.type(''));
      picker.simulation.at(200, KEYSTROKE, () => picker.type('ro'));
      picker.simulation.at(250, KEYSTROKE, () => picker.type('roa'));
      picker.simulation.at(300, KEYSTROKE, () => picker.scheduler.close());
      await picker.simulation.run();

      expect(picker.events.map(({ t_ms, event, query }) => [t_ms, event, query])).toEqual([
        [0, 'send', ''],
        [200, 'send', 'ro'],
        [300, 'abort', 'ro'],
        [1_000, 'complete', ''],
      ]);

      const refreshing = new Picker(1_000, contractSettings(true));

      refreshing.simulation.at(0, KEYSTROKE, () =>
        refreshing.scheduler.input(refreshing.search('ro', { refresh: true }))
      );
      refreshing.simulation.at(100, KEYSTROKE, () => refreshing.scheduler.close());
      await refreshing.simulation.run();
      expect(refreshing.events.map(({ event }) => event)).toEqual(['send', 'complete']);
    });

    it('keeps one-letter Latin queries local only while the session says so', () => {
      const keeping = createMentionSearchScheduler(contractSettings(false));
      const sending = createMentionSearchScheduler(contractSettings(true));

      expect(['r', 'R', 'é', 'ro', '1', '路'].map((query) => keeping.keepsLocal(query))).toEqual([
        true,
        true,
        true,
        false,
        false,
        false,
      ]);
      expect(['r', 'R', 'é'].map((query) => sending.keepsLocal(query))).toEqual([false, false, false]);
    });
  });

  describe('the legacy scheduler (MEN-WEB-01)', () => {
    const legacy: MentionSchedulerSettings = { mode: 'legacy', oneLetterLocal: true };

    it('waits 120 ms after every typed keystroke and sends the bare request on the next tick', async () => {
      const picker = new Picker(50, legacy);

      await picker.replay([
        { t_ms: 0, query: '' },
        { t_ms: 300, query: 'r' },
        { t_ms: 400, query: 'ro' },
        { t_ms: 700, query: 'roa' },
      ]);

      expect(picker.events.filter((event) => event.event === 'send').map(({ t_ms, query }) => [t_ms, query])).toEqual([
        [0, ''],
        [520, 'ro'],
        [820, 'roa'],
      ]);
      expect(LEGACY_MENTION_TYPED_DEBOUNCE_MS).toBe(120);
    });

    it('aborts the typed search of a query when it is withdrawn, and never the bare request or a refresh', async () => {
      const picker = new Picker(1_000, legacy);
      const bare = picker.search('');
      const typed = picker.search('ro');
      const refresh = picker.search('roa', { refresh: true });

      picker.simulation.at(0, KEYSTROKE, () => picker.scheduler.input(bare));
      picker.simulation.at(10, KEYSTROKE, () => {
        picker.scheduler.withdraw(bare);
        picker.scheduler.input(typed);
      });
      picker.simulation.at(200, KEYSTROKE, () => {
        picker.scheduler.withdraw(typed);
        picker.scheduler.input(refresh);
      });
      picker.simulation.at(300, KEYSTROKE, () => {
        picker.scheduler.withdraw(refresh);
        picker.scheduler.close();
      });
      await picker.simulation.run();

      expect(picker.events.map(({ t_ms, event, query }) => [t_ms, event, query])).toEqual([
        [0, 'send', ''],
        [130, 'send', 'ro'],
        [200, 'abort', 'ro'],
        // A refresh goes out at once.
        [200, 'send', 'roa'],
        [1_000, 'complete', ''],
        [1_200, 'complete', 'roa'],
      ]);
    });

    it('drops a typed search withdrawn before its debounce ends, resubmits at once, and never keeps queries local', async () => {
      const picker = new Picker(50, legacy);
      const typed = picker.search('ro');

      picker.simulation.at(0, KEYSTROKE, () => picker.scheduler.input(typed));
      picker.simulation.at(60, KEYSTROKE, () => picker.scheduler.withdraw(typed));
      picker.simulation.at(500, KEYSTROKE, () => picker.scheduler.resubmit(picker.search('roa')));
      await picker.simulation.run();

      expect(picker.events.filter((event) => event.event === 'send').map(({ t_ms, query }) => [t_ms, query])).toEqual([
        [500, 'roa'],
      ]);
      expect(picker.scheduler.keepsLocal('r')).toBe(false);
    });

    it('aborts the typed search in flight when the panel closes', async () => {
      const picker = new Picker(1_000, legacy);

      picker.simulation.at(0, KEYSTROKE, () => picker.type('ro'));
      picker.simulation.at(200, KEYSTROKE, () => picker.scheduler.close());
      await picker.simulation.run();

      expect(picker.events.map(({ t_ms, event }) => [t_ms, event])).toEqual([
        [120, 'send'],
        [200, 'abort'],
      ]);
    });
  });

  describe('the one-letter rule (request.json stays_local)', () => {
    it.each(
      requests.stays_local.map(
        (entry) => [`${JSON.stringify(entry.query)}, short_prefix_v1 ${entry.short_prefix_v1}`, entry] as const
      )
    )('%s', (_name, { query, short_prefix_v1: shortPrefixV1, local }) => {
      expect(mentionQueryStaysLocal(query, shortPrefixV1)).toBe(local);
    });
  });

  describe('session settings', () => {
    const advertising = (features?: string[]): ServerInfoState => ({
      status: 'available',
      info: { enable_page_history: true, mention_features: features },
    });

    afterEach(() => {
      localStorage.clear();
      jest.restoreAllMocks();
    });

    it('keeps the legacy scheduler and sends one-letter queries by default', () => {
      expect(MENTION_SCHEDULER_DEFAULT_MODE).toBe('legacy');
      expect(readMentionSchedulerSettings(advertising())).toEqual({ mode: 'legacy', oneLetterLocal: false });
    });

    it('switches to the contract scheduler through the browser override, and ignores other values', () => {
      localStorage.setItem(MENTION_SCHEDULER_MODE_OVERRIDE_KEY, 'contract');
      expect(readMentionSchedulerSettings(advertising())).toEqual({ mode: 'contract', oneLetterLocal: false });

      localStorage.setItem(MENTION_SCHEDULER_MODE_OVERRIDE_KEY, 'fast');
      expect(readMentionSchedulerSettings(advertising()).mode).toBe('legacy');
    });

    it('keeps one-letter queries local only under the contract scheduler, with the rule on, until short_prefix_v1', () => {
      localStorage.setItem(MENTION_ONE_LETTER_LOCAL_OVERRIDE_KEY, 'true');
      expect(readMentionSchedulerSettings(advertising()).oneLetterLocal).toBe(false);

      localStorage.setItem(MENTION_SCHEDULER_MODE_OVERRIDE_KEY, 'contract');
      expect(readMentionSchedulerSettings(advertising()).oneLetterLocal).toBe(true);
      expect(readMentionSchedulerSettings(SERVER_INFO_LOADING).oneLetterLocal).toBe(true);
      expect(readMentionSchedulerSettings(advertising(['session_metrics_v1'])).oneLetterLocal).toBe(true);
      expect(readMentionSchedulerSettings(advertising([MENTION_FEATURE_SHORT_PREFIX_V1])).oneLetterLocal).toBe(false);

      localStorage.setItem(MENTION_ONE_LETTER_LOCAL_OVERRIDE_KEY, 'false');
      expect(readMentionSchedulerSettings(advertising()).oneLetterLocal).toBe(false);
    });

    it('falls back to the defaults when the browser denies storage', () => {
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });

      expect(readMentionSchedulerSettings(advertising())).toEqual({ mode: 'legacy', oneLetterLocal: false });
    });

    it('reads mention_features only from available server info', () => {
      expect(isMentionFeatureAdvertised('short_prefix_v1', advertising(['short_prefix_v1']))).toBe(true);
      expect(isMentionFeatureAdvertised('short_prefix_v1', advertising())).toBe(false);
      expect(isMentionFeatureAdvertised('short_prefix_v1', SERVER_INFO_LOADING)).toBe(false);
      expect(isMentionFeatureAdvertised('short_prefix_v1', { status: 'unavailable' })).toBe(false);
    });
  });

  describe('MentionSearchFlight', () => {
    function ticket() {
      return { abort: jest.fn() } as unknown as Parameters<MentionSearchFlight<number>['track']>[0];
    }

    it('aborts every request it tracked, and is wanted while a search it serves is current', async () => {
      let firstCurrent = true;
      let secondCurrent = true;
      const interim: string[] = [];
      const tickets = [ticket(), ticket()];
      const flight = new MentionSearchFlight<number, string>({
        outlivesPicker: false,
        watcher: { isCurrent: () => firstCurrent, showInterim: (sections) => interim.push(`first:${sections}`) },
        run: async (current) => {
          tickets.forEach((item) => current.track(item));
          return 7;
        },
      });

      flight.watch({ isCurrent: () => secondCurrent, showInterim: (sections) => interim.push(`second:${sections}`) });
      flight.showInterim('a');
      firstCurrent = false;
      expect(flight.wanted()).toBe(true);
      flight.showInterim('b');
      secondCurrent = false;
      expect(flight.wanted()).toBe(false);

      secondCurrent = true;
      flight.abort();
      expect(flight.wanted()).toBe(false);
      flight.showInterim('c');
      expect(interim).toEqual(['first:a', 'second:a', 'second:b']);
      tickets.forEach((item) => expect(item.abort).toHaveBeenCalledTimes(1));
      await expect(flight.result).resolves.toBe(7);
      await expect(flight.settled).resolves.toBeUndefined();
    });

    it('settles without rejecting when its requests fail', async () => {
      const flight = new MentionSearchFlight<number>({
        outlivesPicker: true,
        watcher: { isCurrent: () => true },
        run: () => Promise.reject(new Error('failed')),
      });

      await expect(flight.settled).resolves.toBeUndefined();
      await expect(flight.result).rejects.toThrow('failed');
      expect(flight.outlivesPicker).toBe(true);
    });
  });
});
