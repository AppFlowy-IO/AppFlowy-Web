/**
 * The dashboard load scheduler against `dashboard-parity/loading-schedule.json`,
 * the cases desktop runs too (`dashboard_load_scheduler_test.dart`).
 */
import {
  busyDashboardSources,
  DASHBOARD_LOADING,
  DashboardLoadingConstants,
  DashboardLoadPlan,
  DashboardLoadPlanInput,
  DashboardLoadWidget,
  planDashboardLoads,
} from '../dashboard-loading';

import { loadParityFixture } from './dashboard-parity-helpers';

type FixtureInput = Omit<DashboardLoadPlanInput, 'constants'>;

interface ScheduleCase {
  name: string;
  input: FixtureInput;
  expected: DashboardLoadPlan;
}

interface ScheduleStep {
  now: number;
  set?: (Pick<DashboardLoadWidget, 'id'> & Partial<Omit<DashboardLoadWidget, 'id' | 'sourceId'>>)[];
  closed?: boolean;
  residentSources?: string[];
  expected: DashboardLoadPlan;
  busySources: string[];
}

interface ScheduleSequence {
  name: string;
  input: FixtureInput;
  steps: ScheduleStep[];
}

interface LoadingScheduleFixture {
  constants: DashboardLoadingConstants;
  cases: ScheduleCase[];
  sequences: ScheduleSequence[];
}

const fixture = loadParityFixture<LoadingScheduleFixture>('loading-schedule.json');
const tokens = loadParityFixture<{ loading: DashboardLoadingConstants }>('tokens.json');

/** The cases FIX-PASS 3.2 requires, by a phrase of their name. */
const REQUIRED_CASES = [
  'visible widgets start before deferred ones',
  'the third distinct source waits',
  'a widget of a loading source starts at once',
  'the host never waits',
  'a finished load frees its slot and the next queued widget in layout order starts',
  'a failed load frees its slot',
  'deferred widgets start after the first data',
  'deferred widgets start after 10 s',
  'a widget scrolled into view jumps the queue',
  'deferred widgets do not start over the row budget',
  'a visible widget starts over the row budget',
  'a suspended widget holds no slot',
  'resumes with visible priority',
  'closed starts nothing',
  '8 widgets over 8 sources never have more than 2 busy sources at any step',
  'a widget of a resident source skips the queue',
  'a loading widget of a resident source holds no slot',
  'warm and cold sources mixed',
  '8 warm sources reopen without waiting',
  'a deferred widget of a resident source still waits for the visible widgets',
  'not even a widget of a resident source',
  'a source whose rows finished loading frees its slot',
];

function sortedBusySources(state: FixtureInput) {
  return [...busyDashboardSources(state.widgets, state.hostSourceId, state.residentSources)].sort();
}

describe('planDashboardLoads (loading-schedule.json)', () => {
  it('runs with the loading constants of tokens.json', () => {
    expect(fixture.constants).toEqual(tokens.loading);
    expect(DASHBOARD_LOADING).toEqual(fixture.constants);
  });

  it('covers every required case, each under its own name', () => {
    const names = [...fixture.cases, ...fixture.sequences].map((entry) => entry.name);

    expect(new Set(names).size).toBe(names.length);
    REQUIRED_CASES.forEach((phrase) => {
      expect(names.filter((name) => name.includes(phrase))).not.toEqual([]);
    });
  });

  it.each(fixture.cases.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    const input = { ...entry.input, constants: fixture.constants };
    const before = JSON.stringify(input);

    expect(planDashboardLoads(input)).toEqual(entry.expected);
    // Pure: the input is left as it was.
    expect(JSON.stringify(input)).toBe(before);
  });

  it('plans an input without residentSources as if every source were cold', () => {
    const cold = fixture.cases.filter((entry) => entry.input.residentSources?.length === 0);

    expect(cold.length).toBeGreaterThan(0);
    cold.forEach((entry) => {
      const { residentSources: _none, ...input } = entry.input;

      expect({ name: entry.name, plan: planDashboardLoads({ ...input, constants: fixture.constants }) }).toEqual({
        name: entry.name,
        plan: entry.expected,
      });
    });
  });

  it('keeps the host and the resident sources out of the busy sources', () => {
    const widgets: DashboardLoadWidget[] = [
      { id: 'w1', sourceId: 'host', visible: true, state: 'loading', firstData: false },
      { id: 'w2', sourceId: 'A', visible: true, state: 'loading', firstData: false },
      { id: 'w3', sourceId: 'B', visible: false, state: 'loading', firstData: true },
      { id: 'w4', sourceId: 'C', visible: true, state: 'suspended', firstData: true },
      { id: 'w5', sourceId: 'D', visible: true, state: 'done', firstData: true },
    ];

    expect([...busyDashboardSources(widgets, 'host')].sort()).toEqual(['A', 'B']);
    expect([...busyDashboardSources(widgets, 'host', ['B'])]).toEqual(['A']);
    expect([...busyDashboardSources(widgets, 'host', new Set(['A', 'B', 'C']))]).toEqual([]);
  });

  it.each(fixture.cases.map((entry) => [entry.name, entry] as const))(
    'never plans more busy sources than slots: %s',
    (_name, entry) => {
      const { start } = planDashboardLoads({ ...entry.input, constants: fixture.constants });
      const started = new Set(start);
      const busyBefore = sortedBusySources(entry.input);
      const busyAfter = sortedBusySources({
        ...entry.input,
        widgets: entry.input.widgets.map((widget) =>
          started.has(widget.id) ? { ...widget, state: 'loading' as const } : widget
        ),
      });

      // A plan only fills free slots: it never adds a source beyond the cap.
      expect(busyAfter.length).toBeLessThanOrEqual(Math.max(busyBefore.length, fixture.constants.maxConcurrentSources));
      expect(new Set(start).size).toBe(start.length);
    }
  );

  it.each(fixture.sequences.map((entry) => [entry.name, entry] as const))('%s', (_name, sequence) => {
    const state: FixtureInput = JSON.parse(JSON.stringify(sequence.input));

    sequence.steps.forEach((step, index) => {
      const where = `step ${index + 1} (now ${step.now})`;

      state.now = step.now;
      (step.set ?? []).forEach(({ id, ...patch }) => {
        const widget = state.widgets.find((candidate) => candidate.id === id);

        if (!widget) throw new Error(`${where}: no widget ${id}`);
        Object.assign(widget, patch);
      });
      if (step.closed !== undefined) state.closed = step.closed;
      if (step.residentSources !== undefined) state.residentSources = step.residentSources;

      const plan = planDashboardLoads({ ...state, constants: fixture.constants });

      expect({ where, plan }).toEqual({ where, plan: step.expected });
      plan.start.forEach((id) => {
        const widget = state.widgets.find((candidate) => candidate.id === id);

        if (!widget) throw new Error(`${where}: started unknown widget ${id}`);
        if (widget.visible && state.visibleStartedAt === null) state.visibleStartedAt = state.now;
        widget.state = 'loading';
      });

      const busy = sortedBusySources(state);

      expect({ where, busy }).toEqual({ where, busy: step.busySources });
      expect(busy.length).toBeLessThanOrEqual(fixture.constants.maxConcurrentSources);
    });
  });
});

describe('planDashboardLoads (generated dashboards)', () => {
  // A deterministic generator (no Math.random), so a failure reproduces.
  function generator(seed: number) {
    let value = seed;

    return (bound: number) => {
      value = (value * 1103515245 + 12345) % 2147483648;
      return Math.floor((value / 2147483648) * bound);
    };
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'seed %i: at most 2 busy sources at every step, and every widget ends done',
    (seed) => {
      const next = generator(seed);
      const sourceCount = 1 + next(8);
      const state: FixtureInput = {
        now: 0,
        hostSourceId: 'host',
        closed: false,
        visibleStartedAt: null,
        sourceRows: {},
        widgets: Array.from({ length: 12 }, (_unused, index) => ({
          id: `w${index + 1}`,
          sourceId: next(6) === 0 ? 'host' : `S${1 + next(sourceCount)}`,
          visible: index < 4,
          state: 'idle' as const,
          firstData: false,
        })),
      };
      const startOrder: string[] = [];

      for (let step = 0; step < 200 && state.widgets.some((widget) => widget.state !== 'done'); step += 1) {
        const { start } = planDashboardLoads({ ...state, constants: fixture.constants });

        start.forEach((id) => {
          const widget = state.widgets.find((candidate) => candidate.id === id) as DashboardLoadWidget;

          expect(widget.state).toBe('idle');
          if (widget.visible && state.visibleStartedAt === null) state.visibleStartedAt = state.now;
          widget.state = 'loading';
          startOrder.push(id);
        });
        expect(sortedBusySources(state).length).toBeLessThanOrEqual(fixture.constants.maxConcurrentSources);

        const loading = state.widgets.filter((widget) => widget.state === 'loading');

        // A finished or failed load always frees its slot: the queue never gets stuck.
        if (loading.length === 0) throw new Error(`stuck queue at step ${step}: ${JSON.stringify(state.widgets)}`);

        // One loading widget reports: its first data, or the end (now and then a failure without any data).
        const reporting = loading[next(loading.length)];

        state.now += 100;
        if (!reporting.firstData && next(2) === 0) {
          reporting.firstData = true;
        } else {
          if (next(5) !== 0) reporting.firstData = true;
          reporting.state = 'done';
        }
      }

      expect(state.widgets.filter((widget) => widget.state !== 'done')).toEqual([]);
      expect([...startOrder].sort()).toEqual(state.widgets.map((widget) => widget.id).sort());
      // Visible first: no off-screen widget starts before the last visible one.
      const lastVisibleStart = Math.max(
        ...state.widgets.filter((widget) => widget.visible).map((widget) => startOrder.indexOf(widget.id))
      );
      const firstDeferredStart = Math.min(
        ...state.widgets.filter((widget) => !widget.visible).map((widget) => startOrder.indexOf(widget.id))
      );

      expect(firstDeferredStart).toBeGreaterThan(lastVisibleStart);
    }
  );

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'seed %i with warm sources: at most 2 busy cold sources at every step, warm visible widgets never wait, every widget ends done',
    (seed) => {
      const next = generator(seed);
      const sourceCount = 1 + next(8);
      // S1 and, by chance, other sources are warm from the start; a source turns warm once a widget of it has loaded.
      const resident = new Set(
        Array.from({ length: sourceCount }, (_unused, index) => `S${index + 1}`).filter(
          (sourceId) => sourceId === 'S1' || next(2) === 0
        )
      );
      const state: FixtureInput = {
        now: 0,
        hostSourceId: 'host',
        closed: false,
        visibleStartedAt: null,
        sourceRows: {},
        residentSources: [],
        widgets: Array.from({ length: 12 }, (_unused, index) => ({
          id: `w${index + 1}`,
          sourceId: next(6) === 0 ? 'host' : `S${1 + next(sourceCount)}`,
          visible: index < 4,
          state: 'idle' as const,
          firstData: false,
        })),
      };
      const startOrder: string[] = [];
      let warmStarts = 0;

      for (let step = 0; step < 200 && state.widgets.some((widget) => widget.state !== 'done'); step += 1) {
        state.residentSources = [...resident].sort();
        const { start } = planDashboardLoads({ ...state, constants: fixture.constants });

        start.forEach((id) => {
          const widget = state.widgets.find((candidate) => candidate.id === id) as DashboardLoadWidget;

          expect(widget.state).toBe('idle');
          if (widget.visible && state.visibleStartedAt === null) state.visibleStartedAt = state.now;
          if (resident.has(widget.sourceId)) warmStarts += 1;
          widget.state = 'loading';
          startOrder.push(id);
        });
        expect(sortedBusySources(state).length).toBeLessThanOrEqual(fixture.constants.maxConcurrentSources);
        // Warm sources skip the queue: no visible widget of the host or of a resident source is left waiting.
        expect(
          state.widgets.filter(
            (widget) =>
              widget.visible &&
              widget.state === 'idle' &&
              (widget.sourceId === state.hostSourceId || resident.has(widget.sourceId))
          )
        ).toEqual([]);

        const loading = state.widgets.filter((widget) => widget.state === 'loading');

        if (loading.length === 0) throw new Error(`stuck queue at step ${step}: ${JSON.stringify(state.widgets)}`);

        const reporting = loading[next(loading.length)];

        state.now += 100;
        if (!reporting.firstData && next(2) === 0) {
          reporting.firstData = true;
        } else {
          if (next(5) !== 0) reporting.firstData = true;
          reporting.state = 'done';
          // A load that ended with data leaves its source's rows in memory; a failed one does not.
          if (reporting.firstData && reporting.sourceId !== state.hostSourceId) resident.add(reporting.sourceId);
        }
      }

      expect(warmStarts).toBeGreaterThan(0);
      expect(state.widgets.filter((widget) => widget.state !== 'done')).toEqual([]);
      expect([...startOrder].sort()).toEqual(state.widgets.map((widget) => widget.id).sort());
      const lastVisibleStart = Math.max(
        ...state.widgets.filter((widget) => widget.visible).map((widget) => startOrder.indexOf(widget.id))
      );
      const firstDeferredStart = Math.min(
        ...state.widgets.filter((widget) => !widget.visible).map((widget) => startOrder.indexOf(widget.id))
      );

      expect(firstDeferredStart).toBeGreaterThan(lastVisibleStart);
    }
  );
});
