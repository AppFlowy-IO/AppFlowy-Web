/**
 * Query-to-selection memory for the @-mention picker (MEN-WEB-10): which item the user inserted
 * after typing what, so that typing it again puts that item first in its tier. It ports
 * `mention_typeahead::PickMemory` of the typeahead contract (AppFlowy-Cloud-Premium
 * `doc/context/workspace/mention_typeahead_contract.md`, section Pick memory, decision D12), and
 * `__fixtures__/mention-parity/pick-memory.json` pins it to the Rust reference and to Desktop:
 *
 * - A pick of item `k` after typed input `i` (normalized; a bare `@` is not recorded) sets the
 *   entry `(k, i)` to `floor(count × 9 / 10) + 1 000 000`, where `count` is its decayed count, and
 *   restarts its decay clock. These are Firefox's adaptive-history parameters, as integers in
 *   millionths.
 * - Every whole day since the entry was set takes `floor(count × 975 / 1000)`; a clock that went
 *   back decays nothing. An entry below 100 000 (0.1) is forgotten.
 * - An item's score while the user has typed `t`: the best count among its live entries whose
 *   input starts with `t`, the entry for exactly `t` counting double. `adaptive =
 *   min(1 000 000, best / 10)` is the first key inside a tier (`mentionLocalRanker.ts`), and `lift`
 *   (the entry for exactly `t` alone reaches 600 000) lifts the item one tier.
 * - At most 1 000 entries. Inserting into a full memory drops the forgotten entries, then the
 *   weakest: the smallest decayed count, then the oldest, then the smallest key and input by code
 *   point.
 *
 * Integers and whole days, never a floating-point power, so V8, the Dart VM and Rust compute the
 * same numbers.
 *
 * The picker keeps one memory per workspace and user in `localStorage`, under
 * `af.mention.pick-memory.v1:<workspace_id>:<uid>`. It holds normalized inputs of at most 32 code
 * points, navigation keys of people, pages, databases and rows, counts and times: no title, name or
 * address, and nothing is ever sent to a server. Only an insertion records a pick; what the picker
 * shows, highlights or hovers never does. Every storage access is guarded: storage can be missing,
 * full or blocked, and then the memory is empty and picks are not kept. An explicit sign-out
 * removes the user's memories ({@link removeMentionPickMemoryForUser}); a session that expires
 * keeps them, like the device's other local state.
 *
 * The picker uses it only while it is switched on ({@link readMentionPickMemoryEnabled}), off by
 * default until the replay gate (MEN-X-07) and product sign-off. Nothing here depends on React.
 */
import { boundMentionText, compareCodePoints, countCodePoints, normalizeMentionText } from '@/utils/normalize-text';

/** One whole unit, a use count of 1 or an `adaptive` of 1.0, in millionths. */
export const MENTION_PICK_SCALE = 1_000_000;
/** Entries one memory keeps (contract D12). A full memory forgets its weakest entry first. */
export const MENTION_PICK_MAX_ENTRIES = 1_000;
/**
 * The picker records a pick only when its normalized input has at most this many code points
 * (the plan's bound), which keeps a memory small and holds no typed sentence. A longer input is
 * rarely typed twice, and scores nothing: no stored input starts with it.
 */
export const MENTION_PICK_MAX_INPUT_CODE_POINTS = 32;
/** Prefix of the `localStorage` keys, `<prefix>:<workspace_id>:<uid>`. */
export const MENTION_PICK_MEMORY_STORAGE_PREFIX = 'af.mention.pick-memory.v1';
/** The version stored with each memory. */
export const MENTION_PICK_MEMORY_VERSION = 1;
/** Whether the picker uses pick memory, unless the browser overrides it. */
export const MENTION_PICK_MEMORY_DEFAULT = false;
/** `localStorage` key that switches pick memory on (`true`) or off (`false`) for new picker sessions. */
export const MENTION_PICK_MEMORY_OVERRIDE_KEY = '__mention_pick_memory';

const DAY_MS = 86_400_000;
/** Counts below 0.1 are forgotten. */
const FORGET_BELOW = MENTION_PICK_SCALE / 10;
/** `adaptive` at or above 0.6 from the typed input itself lifts an item one tier. */
const LIFT_AT = (MENTION_PICK_SCALE / 10) * 6;

/** What the memory knows about one item for the typed input. */
export interface MentionPickScore {
  /** `min(1, best / 10)` in millionths ({@link MENTION_PICK_SCALE}): the first key inside a tier. */
  readonly adaptive: number;
  /** The entry for exactly the typed input reaches an `adaptive` of 0.6 on its own. */
  readonly lift: boolean;
}

/** One entry as stored: navigation key, normalized input, use count in millionths, anchor time. */
export type MentionPickStoredEntry = readonly [key: string, input: string, count: number, anchorMs: number];

export interface MentionPickMemoryOptions {
  /** Entries kept, at least one; {@link MENTION_PICK_MAX_ENTRIES} by default. */
  capacity?: number;
  /** Picks whose normalized input has more code points are not recorded; no bound by default. */
  maxInputCodePoints?: number;
}

interface PickEntry {
  /** The use count in millionths as of `anchorMs`. */
  count: number;
  /** When the count was last set; decay counts whole days from here. */
  anchorMs: number;
}

const NO_SCORE: MentionPickScore = Object.freeze({ adaptive: 0, lift: false });

/** `floor(a / b)` for non-negative integers, exactly: `%` is exact on doubles. */
function floorDiv(a: number, b: number): number {
  return (a - (a % b)) / b;
}

/** The count at `nowMs`: 2.5 % off per whole day since the anchor, rounded down each day. */
function decayed(entry: PickEntry, nowMs: number): number {
  // A clock that went back decays nothing.
  let days = nowMs > entry.anchorMs ? floorDiv(nowMs - entry.anchorMs, DAY_MS) : 0;
  let count = entry.count;

  // A count of at most 10 falls below 0.1 within 183 days, so this loop is short whatever the gap.
  while (days > 0 && count >= FORGET_BELOW) {
    count = floorDiv(count * 975, 1_000);
    days -= 1;
  }

  return count;
}

/** The count at `nowMs`, or `undefined` once it is forgotten. */
function live(entry: PickEntry, nowMs: number): number | undefined {
  const count = decayed(entry, nowMs);

  return count >= FORGET_BELOW ? count : undefined;
}

/** `min(1, rank / 10)` in millionths. */
function adaptive(rank: number): number {
  return Math.min(MENTION_PICK_SCALE, floorDiv(rank, 10));
}

/** The typed input as the memory keys it: normalized as the matcher does, empty for a bare `@`. */
export function normalizeMentionPickInput(input: string): string {
  return normalizeMentionText(boundMentionText(input));
}

/** Query-to-selection memory for one workspace and user. */
export class MentionPickMemory {
  /** By the item's navigation key, then the normalized input it was picked for. */
  private readonly entries = new Map<string, Map<string, PickEntry>>();
  private count = 0;
  readonly capacity: number;
  readonly maxInputCodePoints: number;

  constructor({ capacity = MENTION_PICK_MAX_ENTRIES, maxInputCodePoints = Infinity }: MentionPickMemoryOptions = {}) {
    this.capacity = Number.isFinite(capacity) ? Math.max(1, Math.floor(capacity)) : MENTION_PICK_MAX_ENTRIES;
    this.maxInputCodePoints = maxInputCodePoints;
  }

  /** Entries held, forgotten ones included until a full memory drops them. */
  get size(): number {
    return this.count;
  }

  /**
   * Records that the user picked `key` after typing `input`. Returns whether it was recorded: a
   * bare `@`, or an input longer than {@link maxInputCodePoints}, is not.
   */
  recordPick(input: string, key: string, nowMs: number): boolean {
    const normalized = normalizeMentionPickInput(input);

    if (!normalized || countCodePoints(normalized) > this.maxInputCodePoints) return false;

    const existing = this.entries.get(key)?.get(normalized);
    const previous = existing ? live(existing, nowMs) ?? 0 : 0;

    if (!existing) this.makeRoom(nowMs);
    this.set(key, normalized, { count: floorDiv(previous * 9, 10) + MENTION_PICK_SCALE, anchorMs: nowMs });
    return true;
  }

  /** The score of `key` while the user has typed `input`; a bare `@` scores nothing. */
  score(input: string, key: string, nowMs: number): MentionPickScore {
    const normalized = normalizeMentionPickInput(input);

    return normalized ? scoreEntries(normalized, this.entries.get(key), nowMs) : NO_SCORE;
  }

  /**
   * Every item with a live entry whose input starts with `input`, and its score. An item left out
   * scores nothing, so this is {@link score} for all items at once: one pass per keystroke.
   */
  scores(input: string, nowMs: number): Map<string, MentionPickScore> {
    const normalized = normalizeMentionPickInput(input);
    const scores = new Map<string, MentionPickScore>();

    if (!normalized) return scores;

    this.entries.forEach((inputs, key) => {
      const score = scoreEntries(normalized, inputs, nowMs);

      if (score.adaptive > 0) scores.set(key, score);
    });
    return scores;
  }

  /** The decayed use count in millionths of the entry for exactly `input` and `key`, or `null`. */
  useCount(input: string, key: string, nowMs: number): number | null {
    const normalized = normalizeMentionPickInput(input);
    const entry = normalized ? this.entries.get(key)?.get(normalized) : undefined;

    return (entry && live(entry, nowMs)) ?? null;
  }

  /** The entries still live at `nowMs`, by key and then input in code point order, to store. */
  liveEntries(nowMs: number): MentionPickStoredEntry[] {
    const stored: MentionPickStoredEntry[] = [];

    this.entries.forEach((inputs, key) => {
      inputs.forEach((entry, input) => {
        if (live(entry, nowMs) !== undefined) stored.push([key, input, entry.count, entry.anchorMs]);
      });
    });
    return stored.sort((a, b) => compareCodePoints(a[0], b[0]) || compareCodePoints(a[1], b[1]));
  }

  /**
   * Restores a stored entry as it was set, without counting a pick. The first entry for a key and
   * input wins, and a full memory makes room as a pick would.
   */
  restore(key: string, input: string, count: number, anchorMs: number, nowMs: number): void {
    if (this.entries.get(key)?.has(input)) return;

    this.makeRoom(nowMs);
    this.set(key, input, { count, anchorMs });
  }

  private set(key: string, input: string, entry: PickEntry): void {
    let inputs = this.entries.get(key);

    if (!inputs) {
      inputs = new Map();
      this.entries.set(key, inputs);
    }

    if (!inputs.has(input)) this.count += 1;
    inputs.set(input, entry);
  }

  private delete(key: string, input: string): void {
    const inputs = this.entries.get(key);

    if (!inputs?.delete(input)) return;
    this.count -= 1;
    if (inputs.size === 0) this.entries.delete(key);
  }

  /**
   * Frees one slot when the memory is full: forgotten entries go first, then the weakest entry, the
   * oldest of equally weak ones, then the first by key and input.
   */
  private makeRoom(nowMs: number): void {
    if (this.count < this.capacity) return;

    const forgotten: [string, string][] = [];

    this.entries.forEach((inputs, key) => {
      inputs.forEach((entry, input) => {
        if (live(entry, nowMs) === undefined) forgotten.push([key, input]);
      });
    });
    forgotten.forEach(([key, input]) => this.delete(key, input));
    if (this.count < this.capacity) return;

    let weakest: { key: string; input: string; count: number; anchorMs: number } | undefined;

    this.entries.forEach((inputs, key) => {
      inputs.forEach((entry, input) => {
        const count = decayed(entry, nowMs);

        if (
          !weakest ||
          (count - weakest.count ||
            entry.anchorMs - weakest.anchorMs ||
            compareCodePoints(key, weakest.key) ||
            compareCodePoints(input, weakest.input)) < 0
        ) {
          weakest = { key, input, count, anchorMs: entry.anchorMs };
        }
      });
    });
    if (weakest) this.delete(weakest.key, weakest.input);
  }
}

/** The score of one item's entries for the normalized typed input. */
function scoreEntries(
  input: string,
  inputs: ReadonlyMap<string, PickEntry> | undefined,
  nowMs: number
): MentionPickScore {
  if (!inputs) return NO_SCORE;

  let best = 0;
  let exact = 0;

  inputs.forEach((entry, stored) => {
    if (!stored.startsWith(input)) return;

    const count = live(entry, nowMs);

    if (count === undefined) return;

    const rank = stored === input ? (exact = count * 2) : count;

    best = Math.max(best, rank);
  });

  return best === 0 ? NO_SCORE : { adaptive: adaptive(best), lift: adaptive(exact) >= LIFT_AT };
}

// ---------------------------------------------------------------------------
// The picker's memories in localStorage
// ---------------------------------------------------------------------------

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
/**
 * The navigation keys a pick may store: people, pages, databases (with their view, or `-`) and
 * rows, by id only. Dates and reminders are keyed by their title and links by their address, which
 * the memory never stores, and a key built from a title because an item had no id is no key here.
 */
const RECORDABLE_KEY = new RegExp(
  `^(?:person:${UUID}|page:${UUID}|database:${UUID}:(?:${UUID}|-)|row:${UUID}:${UUID})$`
);

/** Whether a pick of the item with this navigation key is recorded. */
export function isMentionPickKey(key: string): boolean {
  return RECORDABLE_KEY.test(key);
}

function idPart(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  const text = String(value);

  return text === '' || text.includes(':') ? null : text;
}

/**
 * `af.mention.pick-memory.v1:<workspace_id>:<uid>`, the storage key of a workspace and user's
 * memory, or `null` (nothing is kept) while either is unknown.
 */
export function mentionPickMemoryStorageKey(
  workspaceId: string | null | undefined,
  userId: string | number | null | undefined
): string | null {
  const workspace = idPart(workspaceId);
  const user = idPart(userId);

  return workspace && user ? `${MENTION_PICK_MEMORY_STORAGE_PREFIX}:${workspace}:${user}` : null;
}

function isStorageKeyOfUser(key: string, userId: string): boolean {
  const parts = key.split(':');

  return parts.length === 3 && parts[0] === MENTION_PICK_MEMORY_STORAGE_PREFIX && parts[2] === userId;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** A memory the picker keeps: the contract's capacity and the plan's input bound. */
function storedMemory(): MentionPickMemory {
  return new MentionPickMemory({ maxInputCodePoints: MENTION_PICK_MAX_INPUT_CODE_POINTS });
}

/**
 * A pick sets a count of at least one whole use, and counts converge on ten from below
 * (`0.9 × 10 + 1 = 10`), so a stored count outside that range was not written by this memory.
 */
const MIN_STORED_COUNT = MENTION_PICK_SCALE;
const MAX_STORED_COUNT = 10 * MENTION_PICK_SCALE;

function isStoredEntry(value: unknown): value is MentionPickStoredEntry {
  if (!Array.isArray(value) || value.length !== 4) return false;

  const [key, input, count, anchorMs] = value as unknown[];

  return (
    typeof key === 'string' &&
    isMentionPickKey(key) &&
    typeof input === 'string' &&
    input !== '' &&
    countCodePoints(input) <= MENTION_PICK_MAX_INPUT_CODE_POINTS &&
    Number.isSafeInteger(count) &&
    (count as number) >= MIN_STORED_COUNT &&
    (count as number) <= MAX_STORED_COUNT &&
    Number.isSafeInteger(anchorMs)
  );
}

/** Restores `raw` into `memory`; `false` when it is no memory of this version. Bad entries are skipped. */
function decodeInto(memory: MentionPickMemory, raw: string, nowMs: number): boolean {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }

  if (typeof parsed !== 'object' || parsed === null) return false;

  const { v, e } = parsed as { v?: unknown; e?: unknown };

  if (v !== MENTION_PICK_MEMORY_VERSION || !Array.isArray(e)) return false;

  e.forEach((entry) => {
    if (isStoredEntry(entry)) memory.restore(entry[0], entry[1], entry[2], entry[3], nowMs);
  });
  return true;
}

function readMemory(store: Storage, storageKey: string, nowMs: number): MentionPickMemory {
  const memory = storedMemory();
  const raw = store.getItem(storageKey);

  // A value this version cannot read is dropped, so it never blocks the memory that replaces it.
  if (raw !== null && !decodeInto(memory, raw, nowMs)) store.removeItem(storageKey);
  return memory;
}

/**
 * The memory stored under `storageKey` ({@link mentionPickMemoryStorageKey}), read once when a
 * picker opens. Empty when there is none, when it cannot be read, or when storage is unavailable.
 */
export function loadMentionPickMemory(storageKey: string, nowMs = Date.now()): MentionPickMemory {
  const store = storage();

  if (!store) return storedMemory();

  try {
    return readMemory(store, storageKey, nowMs);
  } catch {
    return storedMemory();
  }
}

/**
 * Records that the user inserted the item `key` after typing `input`, in the memory under
 * `storageKey`. Reads the stored memory again first, so a pick another tab recorded since this
 * picker opened is kept. Only forgotten entries are pruned. A bare `@`, an input longer than
 * {@link MENTION_PICK_MAX_INPUT_CODE_POINTS} code points, a date, reminder or link, or a storage
 * failure records nothing, and never throws.
 */
export function recordMentionPick(storageKey: string, input: string, key: string, nowMs = Date.now()): void {
  if (!isMentionPickKey(key)) return;

  const store = storage();

  if (!store) return;

  try {
    const memory = readMemory(store, storageKey, nowMs);

    if (!memory.recordPick(input, key, nowMs)) return;
    store.setItem(storageKey, JSON.stringify({ v: MENTION_PICK_MEMORY_VERSION, e: memory.liveEntries(nowMs) }));
  } catch {
    // Storage is full or blocked: the pick is not kept, and the picker works as before.
  }
}

/** Removes every memory of `userId` on this device, in every workspace: the sign-out cleanup. */
export function removeMentionPickMemoryForUser(userId: string | number | null | undefined): void {
  const user = idPart(userId);
  const store = storage();

  if (!user || !store) return;

  try {
    const keys: string[] = [];

    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);

      if (key && isStorageKeyOfUser(key, user)) keys.push(key);
    }

    keys.forEach((key) => store.removeItem(key));
  } catch {
    // Storage is blocked: there is nothing it could hold either.
  }
}

/**
 * Whether a picker session that opens now uses pick memory: {@link MENTION_PICK_MEMORY_DEFAULT},
 * unless `localStorage.__mention_pick_memory` is `true` or `false`. When it is off, the picker
 * neither records picks nor reads them, and shows the server's order. Denied storage keeps the
 * default.
 */
export function readMentionPickMemoryEnabled(): boolean {
  try {
    const override = storage()?.getItem(MENTION_PICK_MEMORY_OVERRIDE_KEY) ?? null;

    return override === 'true' ? true : override === 'false' ? false : MENTION_PICK_MEMORY_DEFAULT;
  } catch {
    return MENTION_PICK_MEMORY_DEFAULT;
  }
}
