import { TextDecoder } from 'util';

import { LIST_ROW_ACTIONS_WIDTH } from '@/components/database/list/list.constants';

import {
  computeManifest,
  listParityFiles,
  loadParityFixture,
  MANIFEST_FILE,
  readParityFile,
} from './dashboard-parity-helpers';

interface LayoutCase {
  name: string;
  stored: unknown;
  write: unknown;
  writtenKeys: unknown;
  expected: unknown;
}

interface LoadingPlan {
  start: string[];
  nextWakeAt: number | null;
}

interface LoadingScheduleFixture {
  format: Record<string, unknown>;
  constants: Record<string, number>;
  cases: { name: string; input: Record<string, unknown>; expected: LoadingPlan }[];
  sequences: {
    name: string;
    input: Record<string, unknown>;
    steps: {
      now: number;
      set?: Record<string, unknown>[];
      closed?: boolean;
      expected: LoadingPlan;
      busySources: string[];
    }[];
  }[];
}

const LOADING_INPUT_KEYS = ['closed', 'hostSourceId', 'now', 'sourceRows', 'visibleStartedAt', 'widgets'];
const LOADING_WIDGET_KEYS = ['firstData', 'id', 'sourceId', 'state', 'visible'];
const LOADING_STATES = ['idle', 'loading', 'suspended', 'done'];

describe('dashboard-parity fixtures', () => {
  const files = listParityFiles();

  it('match their FIXTURES.sha256 manifest', () => {
    const expected = computeManifest();
    const committed = readParityFile(MANIFEST_FILE).toString('utf8');

    if (committed !== expected) {
      // The whole manifest, ready to paste (or regenerate it as README.md says).
      throw new Error(`${MANIFEST_FILE} is out of date. Expected:\n${expected}`);
    }
  });

  it.each(files)('%s is UTF-8 without a BOM, with LF line endings and one trailing newline', (name) => {
    const bytes = readParityFile(name);

    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).not.toThrow();
    expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.toString('utf8');

    expect(text.includes('\r')).toBe(false);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it.each(files.filter((name) => name.endsWith('.json')))('%s parses and is indented with 2 spaces', (name) => {
    expect(() => loadParityFixture(name)).not.toThrow();
    readParityFile(name)
      .toString('utf8')
      .split('\n')
      .forEach((line) => {
        const indent = /^[ \t]*/.exec(line)?.[0] ?? '';

        expect(indent.includes('\t')).toBe(false);
        expect(indent.length % 2).toBe(0);
      });
  });

  it('describes every unknown-keys case completely', () => {
    const fixture = loadParityFixture<{ dashboardCases: LayoutCase[]; chartCases: LayoutCase[] }>(
      'layouts/unknown-keys.json'
    );

    expect(fixture.dashboardCases.length).toBeGreaterThan(0);
    expect(fixture.chartCases.length).toBeGreaterThan(0);
    [...fixture.dashboardCases, ...fixture.chartCases].forEach((entry) => {
      expect(typeof entry.name).toBe('string');
      expect(entry).toHaveProperty('stored');
      expect(entry).toHaveProperty('write');
      expect(Array.isArray(entry.writtenKeys)).toBe(true);
      expect(entry).toHaveProperty('expected');
    });
  });

  it('describes every loading-schedule case and step completely', () => {
    const fixture = loadParityFixture<LoadingScheduleFixture>('loading-schedule.json');
    const tokens = loadParityFixture<{ loading: Record<string, number> }>('tokens.json');
    const expectInput = (input: Record<string, unknown>) => {
      expect(Object.keys(input).sort()).toEqual(LOADING_INPUT_KEYS);
      const widgets = input.widgets as Record<string, unknown>[];

      expect(widgets.length).toBeGreaterThan(0);
      widgets.forEach((widget) => {
        expect(Object.keys(widget).sort()).toEqual(LOADING_WIDGET_KEYS);
        expect(LOADING_STATES).toContain(widget.state);
        expect(typeof widget.visible).toBe('boolean');
        expect(typeof widget.firstData).toBe('boolean');
      });
      expect(new Set(widgets.map((widget) => widget.id)).size).toBe(widgets.length);
    };
    const expectPlan = (plan: LoadingPlan) => {
      expect(Object.keys(plan).sort()).toEqual(['nextWakeAt', 'start']);
      expect(Array.isArray(plan.start)).toBe(true);
      expect(plan.nextWakeAt === null || Number.isInteger(plan.nextWakeAt)).toBe(true);
    };

    expect(fixture.constants).toEqual(tokens.loading);
    expect(Object.keys(fixture.format).sort()).toEqual([
      'cases',
      'constants',
      'planDashboardLoads',
      'rules',
      'sequences',
    ]);
    expect(fixture.cases.length).toBeGreaterThan(0);
    expect(fixture.sequences.length).toBeGreaterThan(0);
    fixture.cases.forEach((entry) => {
      expect(Object.keys(entry).sort()).toEqual(['expected', 'input', 'name']);
      expectInput(entry.input);
      expectPlan(entry.expected);
    });
    fixture.sequences.forEach((sequence) => {
      expect(Object.keys(sequence).sort()).toEqual(['input', 'name', 'steps']);
      expectInput(sequence.input);
      expect(sequence.steps.length).toBeGreaterThan(0);
      sequence.steps.forEach((step, index) => {
        const allowed = ['busySources', 'closed', 'expected', 'now', 'set'];

        expect(Object.keys(step).filter((key) => !allowed.includes(key))).toEqual([]);
        expectPlan(step.expected);
        expect(step.busySources).toEqual([...step.busySources].sort());
        expect(step.busySources.length).toBeLessThanOrEqual(fixture.constants.maxConcurrentSources);
        // Time never runs backwards within a sequence.
        if (index > 0) expect(step.now).toBeGreaterThanOrEqual(sequence.steps[index - 1].now);
        (step.set ?? []).forEach((patch) => {
          expect(typeof patch.id).toBe('string');
          expect(Object.keys(patch).filter((key) => !['id', 'visible', 'state', 'firstData'].includes(key))).toEqual([]);
        });
      });
    });
  });

  it('gives a list widget row title the inset web renders', () => {
    const { geometry } = loadParityFixture<{ geometry: Record<string, number> }>('widget-content.json');

    // The row-actions slot (kept by read-only rows), then the row's 6px padding and the title's 2px inset
    // (`ListRow.tsx`). The widget's 12px start padding is absorbed by the slot (`List.tsx`).
    expect(geometry.list_title_inset).toBe(LIST_ROW_ACTIONS_WIDTH + 6 + 2);
    expect(geometry.list_title_inset).toBe(48);
    expect(geometry.start_inset).toBeLessThanOrEqual(LIST_ROW_ACTIONS_WIDTH);
  });
});
