/**
 * Records the framework errors and warnings a page reports while a dashboard
 * scenario drives it (addendum: the interaction sweep, `SWEEP`):
 *
 * - `console.error` messages and any console message starting with
 *   "Warning:" (React reports its warnings that way),
 * - uncaught exceptions (`pageerror`),
 * - unhandled promise rejections, recorded by an init script in the page.
 *
 * Each record carries the control that was open when it arrived ("Grid /
 * Edit / Filter"), so a failure names the widget, the mode and the control.
 * Desktop records the same classes of errors with
 * `integration_test/shared/dashboard_error_collector.dart`.
 *
 * Nothing is ignored except the entries of `ALLOWED_NOISE`, each with the
 * reason it is not a framework error.
 */
import { ConsoleMessage, expect, Page } from '@playwright/test';

export type FrameworkErrorKind = 'console-error' | 'console-warning' | 'page-error' | 'unhandled-rejection';

export interface FrameworkErrorRecord {
  kind: FrameworkErrorKind;
  text: string;
  /** The control that was open when the error arrived. */
  context: string;
}

interface AllowedNoise {
  name: string;
  reason: string;
  matches: (record: { kind: FrameworkErrorKind; text: string; url?: string }) => boolean;
}

/**
 * Messages that are not framework errors. Add an entry only with the reason
 * it is not one; never to hide an error the app raises.
 */
const ALLOWED_NOISE: AllowedNoise[] = [
  {
    name: 'failed HTTP response',
    reason:
      'Chromium logs every HTTP response with an error status as a console error of its own ("Failed to load ' +
      'resource"). It is network noise, not app code: the scenarios that depend on a request assert its result.',
    matches: ({ kind, text }) => kind === 'console-error' && text.startsWith('Failed to load resource:'),
  },
  {
    name: 'websocket reconnect',
    reason:
      'Chromium logs a dropped or refused WebSocket handshake as a console error; the realtime channel reconnects ' +
      'by design and the sweep does not test the network.',
    matches: ({ kind, text }) => kind === 'console-error' && /^WebSocket connection to .+ failed/.test(text),
  },
  {
    name: 'ResizeObserver loop',
    reason:
      'Browsers report "ResizeObserver loop completed with undelivered notifications" when an observer callback ' +
      'resizes what it observes; the notification is delivered in the next frame. It is a browser notice raised ' +
      'outside app code, not an exception.',
    matches: ({ text }) => /^ResizeObserver loop (completed with undelivered notifications|limit exceeded)/.test(text),
  },
];

/** The in-page buffer the init script fills with unhandled rejections. */
const REJECTIONS_KEY = '__DASHBOARD_UNHANDLED_REJECTIONS__';

function recordRejectionsInPage(key: string) {
  const win = window as unknown as Record<string, unknown>;

  if (Array.isArray(win[key])) return;
  const records: string[] = [];

  win[key] = records;
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown;

    records.push(
      reason instanceof Error ? `${reason.name}: ${reason.message}` : typeof reason === 'string' ? reason : String(reason)
    );
  });
}

export class DashboardErrorCollector {
  readonly records: FrameworkErrorRecord[] = [];
  private context = 'the dashboard';
  private started = false;

  constructor(private readonly page: Page) {}

  /** Start recording on the page: the current document and every later one. */
  async start() {
    if (this.started) return;
    this.started = true;
    this.page.on('console', (message) => this.onConsole(message));
    this.page.on('pageerror', (error) => this.add('page-error', `${error.name}: ${error.message}`));
    await this.page.addInitScript(recordRejectionsInPage, REJECTIONS_KEY);
    await this.page.evaluate(recordRejectionsInPage, REJECTIONS_KEY);
  }

  /** Name the control that is open from now on ("Grid / Edit / Filter"). */
  setContext(context: string) {
    this.context = context;
  }

  /** Fail at once when anything was recorded since recording started. */
  async expectNone(context = this.context) {
    await this.drainRejections();
    expect(this.records, describeRecords(`${context}: a framework error or warning was reported`, this.records)).toEqual(
      []
    );
  }

  private onConsole(message: ConsoleMessage) {
    const type = message.type();
    const text = message.text();

    if (type === 'error') this.add('console-error', text, message.location().url);
    else if (text.startsWith('Warning:')) this.add('console-warning', text, message.location().url);
  }

  private add(kind: FrameworkErrorKind, text: string, url?: string) {
    if (ALLOWED_NOISE.some((noise) => noise.matches({ kind, text, url }))) return;
    this.records.push({ kind, text, context: this.context });
  }

  /** Move the unhandled rejections the page recorded into `records`. */
  private async drainRejections() {
    const rejections = await this.page
      .evaluate((key) => {
        const records = (window as unknown as Record<string, unknown>)[key];

        return Array.isArray(records) ? (records.splice(0, records.length) as string[]) : [];
      }, REJECTIONS_KEY)
      .catch(() => [] as string[]);

    rejections.forEach((text) => this.add('unhandled-rejection', text));
  }
}

function describeRecords(title: string, records: FrameworkErrorRecord[]) {
  return [title, ...records.map((record) => `- [${record.context}] ${record.kind}: ${record.text}`)].join('\n');
}

const collectors = new WeakMap<Page, DashboardErrorCollector>();

/** Start recording framework errors and warnings on `page` (once per scenario page). */
export async function startFrameworkErrorRecording(page: Page) {
  let collector = collectors.get(page);

  if (!collector) {
    collector = new DashboardErrorCollector(page);
    collectors.set(page, collector);
  }

  await collector.start();
  return collector;
}

export function frameworkErrorCollector(page: Page): DashboardErrorCollector {
  const collector = collectors.get(page);

  if (!collector) throw new Error('Framework errors are not being recorded in this scenario');
  return collector;
}
