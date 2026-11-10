/**
 * When a mention picker session sends its searches (MEN-WEB-05).
 *
 * The `contract` scheduler follows the Scheduler section of the @-mention typeahead contract
 * (`doc/context/workspace/mention_typeahead_contract.md` in AppFlowy-Cloud-Premium, version 1; Rust
 * reference `mention_typeahead::simulate_schedule`; vectors in
 * `__fixtures__/mention-parity/schedule.json`):
 *
 * - The bare `@` is sent at once, unless the same one is still in flight, whose answer then answers
 *   it too. Typing never aborts it, and it drops a queued typed query.
 * - A typed query is queued, replacing a queued one. It is ready at once when its keystroke came at
 *   least 100 ms after the previous one, and otherwise 100 ms after its own keystroke.
 * - At most one typed group is in flight. A ready query that asks what the group in flight asks
 *   sends nothing: it is handed that group, whose answer answers it. Any other waits for the group
 *   to end, or aborts it once it has been in flight for 400 ms.
 * - A one-letter Latin query stays on the local lane while the session keeps such queries local.
 *   Web keeps them off until its local lane ships (contract decision D8, MEN-WEB-09).
 *
 * What the contract leaves to clients, Web does this way:
 * - The panel shows a fresh cached answer before the scheduler sees the query. Such a keystroke
 *   sends nothing and drops the queued query. The refresh of a stale cached typed answer is that
 *   query's typed group, so it waits for typing to pause like a search.
 * - Queries compare by cache key, so `Road` asks what `road` asks.
 * - A retry and the end of a server cooldown resubmit a search: ready at once, and no keystroke.
 * - Closing the panel drops the queued search and aborts a typed search in flight, as MEN-WEB-01
 *   does. A refresh and the bare request run to their deadline, so their answers still reach the
 *   cache.
 * - Once a group ends, the queued query is decided on the next timer tick, so a keystroke at the
 *   same instant comes first, in the contract's order.
 *
 * The `legacy` scheduler keeps MEN-WEB-01's rules: a typed search waits 120 ms after every
 * keystroke, a query change aborts the typed search in flight, and the bare request and refreshes
 * go out at once. It stays the default until MEN-WEB-04's session reports give the baseline the
 * contract scheduler is measured against; `readMentionSchedulerSettings` documents the switch.
 *
 * Nothing here depends on React or the network; the clock and timers can be injected.
 */
import { boundMentionText, normalizeMentionText } from '@/utils/normalize-text';
import { getServerInfoSnapshot, type ServerInfoState } from '@/utils/server-info';

import type { MentionRequestTicket } from './mentionRequestLanes';

/** A typed keystroke this long after the previous one is sent at once (the leading edge). */
export const MENTION_SCHEDULER_IDLE_MS = 100;
/** Otherwise its query waits this long after its own keystroke. */
export const MENTION_SCHEDULER_TRAILING_MS = 100;
/** A typed group in flight this long is aborted when another query is ready. */
export const MENTION_SCHEDULER_ABORT_AFTER_MS = 400;
/** The legacy scheduler's wait after every typed keystroke (MEN-WEB-01). */
export const LEGACY_MENTION_TYPED_DEBOUNCE_MS = 120;
/**
 * The `ServerInfo.mention_features` value of a server that answers one-letter queries well. While
 * the one-letter rule is on, it lets one-letter queries go to the server.
 */
export const MENTION_FEATURE_SHORT_PREFIX_V1 = 'short_prefix_v1';

/** The scheduler new picker sessions use, unless the browser overrides it. */
export const MENTION_SCHEDULER_DEFAULT_MODE: MentionSchedulerMode = 'legacy';
/** Whether contract sessions keep one-letter Latin queries local, unless the browser overrides it. */
export const MENTION_ONE_LETTER_LOCAL_DEFAULT = false;
/** `localStorage` key that picks a session's scheduler: `contract` or `legacy`. */
export const MENTION_SCHEDULER_MODE_OVERRIDE_KEY = '__mention_request_scheduler';
/** `localStorage` key that turns the one-letter rule of contract sessions on (`true`) or off (`false`). */
export const MENTION_ONE_LETTER_LOCAL_OVERRIDE_KEY = '__mention_one_letter_local';

/** The requests a scheduler sent for one search, which end and abort together. */
export interface MentionSearchGroup {
  /** Aborts the group's requests, so their answers are never used. */
  abort(): void;
  /** Settles once the group's requests have settled, however they ended. */
  readonly settled: Promise<unknown>;
  /**
   * Whether the group keeps running when the panel closes: a refresh of a cached answer, or the
   * bare request, whose complete answer still reaches the cache. Closing aborts any other.
   */
  readonly outlivesPicker?: boolean;
}

/** One search the panel wants sent: what it asks, and how to send it or serve it otherwise. */
export interface MentionScheduledSearch<G extends MentionSearchGroup = MentionSearchGroup> {
  /** What it asks, as the cache keys it. Two searches with one key share an answer. */
  readonly key: string;
  /** The bare `@`: sent at once on its own lane, and never aborted by typing. */
  readonly bare: boolean;
  /** It revalidates a cached answer on screen. The legacy scheduler sends it at once. */
  readonly refresh: boolean;
  /** Sends the search now. Null when nothing needs sending any more, such as a fresh cached answer. */
  send(): G | null;
  /** The group in flight asks the same, so its answer answers this search too. */
  join(group: G): void;
}

/** The searches of one picker session, from its opening until it closes. */
export interface MentionSearchScheduler<G extends MentionSearchGroup = MentionSearchGroup> {
  /**
   * The picker's query changed. `search` is what the new query needs sent, or null when it needs
   * nothing: a fresh cached answer, a query kept local, or one that waits for a server cooldown.
   */
  input(search: MentionScheduledSearch<G> | null): void;
  /**
   * Sends `search` again without waiting for typing to pause: the user's retry, or the end of a
   * cooldown. Not a keystroke. At most one typed group is still in flight under `contract`.
   */
  resubmit(search: MentionScheduledSearch<G>): void;
  /** `search` is no longer the panel's (its query changed or the panel closed): if it waits, it is dropped. */
  withdraw(search: MentionScheduledSearch<G>): void;
  /**
   * The panel closed: drops the waiting search and aborts the typed search in flight. A refresh
   * and the bare request run on. The scheduler can still be used: StrictMode replays effects.
   */
  close(): void;
  /** Whether a typed `query` stays on the local lane, so no request is sent for it. */
  keepsLocal(query: string): boolean;
}

/** The clock and timers a scheduler runs on; tests inject fake ones. */
export interface MentionSchedulerClock {
  /** Milliseconds on a monotonic clock. */
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface MentionSchedulerTimings {
  idleMs: number;
  trailingMs: number;
  abortAfterMs: number;
}

export const MENTION_SCHEDULER_TIMINGS: MentionSchedulerTimings = {
  idleMs: MENTION_SCHEDULER_IDLE_MS,
  trailingMs: MENTION_SCHEDULER_TRAILING_MS,
  abortAfterMs: MENTION_SCHEDULER_ABORT_AFTER_MS,
};

/** `legacy`: MEN-WEB-01's 120 ms debounce. `contract`: the typeahead contract's scheduler. */
export type MentionSchedulerMode = 'legacy' | 'contract';

/** How a picker session schedules its searches, read once when it opens. */
export interface MentionSchedulerSettings {
  mode: MentionSchedulerMode;
  /** One-letter Latin queries stay on the local lane: the rule is on and the server lacks `short_prefix_v1`. */
  oneLetterLocal: boolean;
}

const BROWSER_CLOCK: MentionSchedulerClock = {
  now: () => (typeof performance === 'undefined' ? Date.now() : performance.now()),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Whether a typed query stays on the local lane: one Latin letter, that is a query that normalizes
 * to one of `a` to `z` (so `R`, `é` and a fullwidth `ｒ` count, while a digit, `ß` or a CJK
 * character does not), until the server lists `short_prefix_v1` (contract `stays_local`, vectors
 * in `request.json`).
 */
export function mentionQueryStaysLocal(query: string, shortPrefixV1 = false): boolean {
  if (shortPrefixV1) return false;

  const normalized = normalizeMentionText(boundMentionText(query));

  return normalized.length === 1 && normalized >= 'a' && normalized <= 'z';
}

/** Whether the server lists `feature` in `ServerInfo.mention_features`. Loading or failed info does not. */
export function isMentionFeatureAdvertised(
  feature: string,
  serverInfo: ServerInfoState = getServerInfoSnapshot()
): boolean {
  const features: unknown = serverInfo.status === 'available' ? serverInfo.info.mention_features : undefined;

  return Array.isArray(features) && features.includes(feature);
}

// A browser override, for trying the contract scheduler before it is the default. Storage can be
// denied, by the getter or the read itself, and then the defaults apply.
function readOverride(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * The settings of a picker session that opens now. The scheduler is `legacy` unless
 * `localStorage.__mention_request_scheduler` is `contract`; switch the default
 * ({@link MENTION_SCHEDULER_DEFAULT_MODE}) once MEN-WEB-04's baseline is in. One-letter queries stay
 * local only under `contract`, with the rule on (`__mention_one_letter_local` is `true`, or
 * {@link MENTION_ONE_LETTER_LOCAL_DEFAULT}) and while the server does not list `short_prefix_v1`.
 */
export function readMentionSchedulerSettings(serverInfo?: ServerInfoState): MentionSchedulerSettings {
  const modeOverride = readOverride(MENTION_SCHEDULER_MODE_OVERRIDE_KEY);
  const mode: MentionSchedulerMode =
    modeOverride === 'contract' || modeOverride === 'legacy' ? modeOverride : MENTION_SCHEDULER_DEFAULT_MODE;
  const ruleOverride = readOverride(MENTION_ONE_LETTER_LOCAL_OVERRIDE_KEY);
  const oneLetterRule = ruleOverride === null ? MENTION_ONE_LETTER_LOCAL_DEFAULT : ruleOverride === 'true';

  return {
    mode,
    oneLetterLocal:
      mode === 'contract' && oneLetterRule && !isMentionFeatureAdvertised(MENTION_FEATURE_SHORT_PREFIX_V1, serverInfo),
  };
}

/** A group in flight, and when it was sent. */
interface Flight<G> {
  readonly key: string;
  readonly group: G;
  readonly sentAt: number;
}

/** A typed search waiting to be sent, and when it is ready. */
interface Queued<G extends MentionSearchGroup> {
  readonly search: MentionScheduledSearch<G>;
  readonly readyAt: number;
}

/** One timer at a time, for the next instant the scheduler has something to decide. */
class SchedulerTimer {
  private readonly clock: MentionSchedulerClock;
  private handle: unknown;
  private armed = false;

  constructor(clock: MentionSchedulerClock) {
    this.clock = clock;
  }

  arm(ms: number, callback: () => void) {
    this.disarm();
    this.armed = true;
    // Rounded up, so a fractional clock never wakes a moment before the instant it waits for.
    this.handle = this.clock.setTimeout(() => {
      this.armed = false;
      callback();
    }, Math.max(0, Math.ceil(ms)));
  }

  disarm() {
    if (!this.armed) return;

    this.armed = false;
    this.clock.clearTimeout(this.handle);
  }
}

class ContractMentionSearchScheduler<G extends MentionSearchGroup> implements MentionSearchScheduler<G> {
  private readonly clock: MentionSchedulerClock;
  private readonly timings: MentionSchedulerTimings;
  private readonly oneLetterLocal: boolean;
  private readonly timer: SchedulerTimer;
  private lastInputAt: number | undefined;
  private queued: Queued<G> | undefined;
  private typed: Flight<G> | undefined;
  private bare: Flight<G> | undefined;

  constructor(clock: MentionSchedulerClock, timings: MentionSchedulerTimings, oneLetterLocal: boolean) {
    this.clock = clock;
    this.timings = timings;
    this.oneLetterLocal = oneLetterLocal;
    this.timer = new SchedulerTimer(clock);
  }

  input(search: MentionScheduledSearch<G> | null) {
    const now = this.clock.now();
    // The keystroke that opened the panel counts, so the first letter right after `@` waits.
    const idle = this.lastInputAt === undefined || now - this.lastInputAt >= this.timings.idleMs;

    this.lastInputAt = now;
    if (!search || search.bare) {
      this.drop();
      if (search) this.sendBare(search, now);
      return;
    }

    this.queue(search, idle ? now : now + this.timings.trailingMs);
  }

  resubmit(search: MentionScheduledSearch<G>) {
    const now = this.clock.now();

    if (search.bare) this.sendBare(search, now);
    else this.queue(search, now);
  }

  withdraw(search: MentionScheduledSearch<G>) {
    if (this.queued?.search === search) this.drop();
  }

  close() {
    this.drop();

    const flight = this.typed;

    if (!flight || flight.group.outlivesPicker) return;

    this.typed = undefined;
    flight.group.abort();
  }

  keepsLocal(query: string) {
    return this.oneLetterLocal && mentionQueryStaysLocal(query);
  }

  private queue(search: MentionScheduledSearch<G>, readyAt: number) {
    this.queued = { search, readyAt };
    this.decide();
  }

  private decide() {
    this.timer.disarm();

    const queued = this.queued;

    if (!queued) return;

    const now = this.clock.now();

    if (queued.readyAt > now) {
      this.timer.arm(queued.readyAt - now, () => this.decide());
      return;
    }

    const flight = this.typed;

    if (flight?.key === queued.search.key) {
      this.queued = undefined;
      queued.search.join(flight.group);
      return;
    }

    if (flight) {
      const age = now - flight.sentAt;

      if (age < this.timings.abortAfterMs) {
        this.timer.arm(this.timings.abortAfterMs - age, () => this.decide());
        return;
      }

      // Forgotten first, so nothing the abort sets off can mistake it for the group in flight.
      this.typed = undefined;
      flight.group.abort();
    }

    this.queued = undefined;

    const group = queued.search.send();

    if (!group) return;

    const sent: Flight<G> = { key: queued.search.key, group, sentAt: now };
    const ended = () => this.typedEnded(sent);

    this.typed = sent;
    void group.settled.then(ended, ended);
  }

  private typedEnded(flight: Flight<G>) {
    if (this.typed !== flight) return;

    this.typed = undefined;
    // On the next tick, so a keystroke at this instant replaces the queued query first.
    if (this.queued) this.timer.arm(0, () => this.decide());
  }

  private sendBare(search: MentionScheduledSearch<G>, now: number) {
    const flight = this.bare;

    if (flight?.key === search.key) {
      search.join(flight.group);
      return;
    }

    const group = search.send();

    if (!group) return;

    const sent: Flight<G> = { key: search.key, group, sentAt: now };
    const ended = () => {
      if (this.bare === sent) this.bare = undefined;
    };

    this.bare = sent;
    void group.settled.then(ended, ended);
  }

  private drop() {
    this.queued = undefined;
    this.timer.disarm();
  }
}

class LegacyMentionSearchScheduler<G extends MentionSearchGroup> implements MentionSearchScheduler<G> {
  private readonly timer: SchedulerTimer;
  private queued: MentionScheduledSearch<G> | undefined;
  private typed: { readonly search: MentionScheduledSearch<G>; readonly group: G } | undefined;

  constructor(clock: MentionSchedulerClock) {
    this.timer = new SchedulerTimer(clock);
  }

  input(search: MentionScheduledSearch<G> | null) {
    this.drop();
    if (!search) return;
    // A refresh goes out at once, and runs to its deadline.
    if (search.refresh) {
      this.send(search);
      return;
    }

    this.queued = search;
    this.timer.arm(search.bare ? 0 : LEGACY_MENTION_TYPED_DEBOUNCE_MS, () => {
      this.queued = undefined;
      this.send(search);
    });
  }

  resubmit(search: MentionScheduledSearch<G>) {
    this.drop();
    this.send(search);
  }

  // A query change aborts the typed search of the query it replaced.
  withdraw(search: MentionScheduledSearch<G>) {
    if (this.queued === search) this.drop();
    if (this.typed?.search === search) this.abortTyped();
  }

  close() {
    this.drop();
    this.abortTyped();
  }

  keepsLocal() {
    return false;
  }

  private send(search: MentionScheduledSearch<G>) {
    const group = search.send();

    if (!group || group.outlivesPicker) return;

    const typed = { search, group };
    const ended = () => {
      if (this.typed === typed) this.typed = undefined;
    };

    this.typed = typed;
    void group.settled.then(ended, ended);
  }

  private abortTyped() {
    const typed = this.typed;

    if (!typed) return;

    this.typed = undefined;
    typed.group.abort();
  }

  private drop() {
    this.queued = undefined;
    this.timer.disarm();
  }
}

/** The scheduler of one picker session. */
export function createMentionSearchScheduler<G extends MentionSearchGroup>(
  settings: MentionSchedulerSettings,
  clock: MentionSchedulerClock = BROWSER_CLOCK,
  timings: MentionSchedulerTimings = MENTION_SCHEDULER_TIMINGS
): MentionSearchScheduler<G> {
  return settings.mode === 'contract'
    ? new ContractMentionSearchScheduler<G>(clock, timings, settings.oneLetterLocal)
    : new LegacyMentionSearchScheduler<G>(clock);
}

/** A search a flight serves: whether it is still the panel's, and where its early sections go. */
export interface MentionFlightWatcher<S> {
  isCurrent(): boolean;
  showInterim?(sections: S): void;
}

/**
 * The group the panel hands the scheduler: one search's requests, which abort together. Its answer
 * serves the search that sent it, and every later search that asked the same and joined it.
 */
export class MentionSearchFlight<R, S = unknown> implements MentionSearchGroup {
  readonly result: Promise<R>;
  readonly settled: Promise<void>;
  readonly outlivesPicker: boolean;
  private readonly tickets: MentionRequestTicket[] = [];
  private readonly watchers: MentionFlightWatcher<S>[];
  private aborted = false;

  constructor({
    outlivesPicker,
    watcher,
    run,
  }: {
    outlivesPicker: boolean;
    watcher: MentionFlightWatcher<S>;
    /** Sends the requests, tracking each ticket, and resolves with their answer. */
    run: (flight: MentionSearchFlight<R, S>) => Promise<R>;
  }) {
    this.outlivesPicker = outlivesPicker;
    this.watchers = [watcher];
    this.result = run(this);
    this.settled = this.result.then(
      () => undefined,
      () => undefined
    );
  }

  /** Records a request the flight sent, so that aborting the flight aborts it. */
  track(ticket: MentionRequestTicket): MentionRequestTicket {
    this.tickets.push(ticket);
    return ticket;
  }

  /** A later search that asks the same is served by this flight too. */
  watch(watcher: MentionFlightWatcher<S>) {
    this.watchers.push(watcher);
  }

  /** Whether a search it serves is still the panel's, and the flight was not aborted. */
  wanted(): boolean {
    return !this.aborted && this.watchers.some((watcher) => watcher.isCurrent());
  }

  /** Shows sections that arrive while the rest of the answer is pending, to the searches still wanting them. */
  showInterim(sections: S) {
    if (this.aborted) return;

    this.watchers.forEach((watcher) => {
      if (watcher.isCurrent()) watcher.showInterim?.(sections);
    });
  }

  abort() {
    this.aborted = true;
    this.tickets.forEach((ticket) => ticket.abort());
  }
}
