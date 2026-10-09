import * as Y from 'yjs';

import {
  plainToYCondition,
  PlainCondition,
  PrivateWidgetEntry,
  sameFilters,
  sameSorts,
} from '@/application/database-yjs/dashboard-private';
import {
  executeDatabaseOperations as executeOperations,
  registerLocalConditionsDoc,
} from '@/application/database-yjs/history';
import { YDatabaseView, YDoc, YjsDatabaseKey, YSharedRoot } from '@/application/types';

/**
 * A viewer's local copy of one view's filters and sorts.
 *
 * Notion keeps the filters and sorts a viewer applies to a dashboard widget in
 * View mode to themselves until an editor chooses "Save for everybody". The
 * overlay gives the widget's nested database a `YDatabaseView` proxy whose
 * `filters` and `sorts` are Y.Arrays in a local, never-synced doc, and forwards
 * everything else to the real view. Every selector, filter menu and dispatcher
 * keeps working unchanged: they read and write the view they are given.
 *
 * Filters and sorts are tracked apart (WP07 decision 1): each local array
 * mirrors the real one until the viewer's copy of that part differs from it
 * ("dirty"); from then on the viewer's version of that part wins until
 * `reset()`, `commit()`, or the two match again. A part that is still clean
 * keeps following the real view. Equality ignores ids, filter order and the
 * order of select ids (`sameFilters` / `sameSorts`), so a pure reorder of
 * filters is not a private change.
 *
 * Edit mode suspends the overlay (`setSuspended`) instead of taking it away:
 * the private parts are set aside, the local arrays follow the real view
 * (every part), and a write to them is written to the real view in the same
 * transaction. The proxy and its arrays keep their identity in both modes, so
 * entering or leaving Edit mode re-renders nothing that reads the view; only
 * the observers of a part whose private copy differs see it change.
 */
export type OverlayPart = 'filters' | 'sorts';

export interface ViewConditionsOverlay {
  /** The proxy to hand to the nested database in place of the real view. */
  view: YDatabaseView;
  /** The current real view, including any replacement received from sync. */
  realView: YDatabaseView;
  /** Follow a replacement of the same source view, retaining private conditions. */
  rebind: (view: YDatabaseView) => void;
  isDirty: () => boolean;
  /** The parts whose private copy differs from the real view. */
  dirtyParts: () => ReadonlySet<OverlayPart>;
  /** Notifies on every change of the dirty parts. */
  subscribe: (listener: () => void) => () => void;
  /** Notifies on every private edit (any local write that is not the mirror), dirty or not. */
  onPrivateChange: (listener: () => void) => () => void;
  /** Drop the local changes and follow the real view again. */
  reset: () => void;
  /** Write the dirty parts to the real view (one undo step) and follow it again. */
  commit: () => void;
  /** The dirty parts as plain JSON (for device-local persistence); `null` when clean. */
  exportPrivate: () => PrivateWidgetEntry | null;
  /**
   * Apply private parts restored from this device after creation. A part the
   * viewer has already changed is never overwritten (their edit won the race).
   */
  restore: (entry: PrivateWidgetEntry) => void;
  /**
   * Edit mode: `true` sets the private parts aside (they stay dirty and are
   * kept, exported, saved or reset as in View mode) and makes the view write
   * through to the real view; `false` brings them back.
   */
  setSuspended: (suspended: boolean) => void;
  isSuspended: () => boolean;
  destroy: () => void;
}

export interface ViewConditionsOverlayOptions {
  /**
   * Private parts to start from (a restore from this device). Written without
   * notifying anyone; the caller has validated them against the source
   * (`sanitizePrivateWidgetEntry`).
   */
  initial?: PrivateWidgetEntry | null;
}

const MIRROR_ORIGIN = { overlay: 'mirror' };
const OVERLAY_PARTS: readonly OverlayPart[] = [YjsDatabaseKey.filters, YjsDatabaseKey.sorts] as OverlayPart[];
const OVERLAY_KEYS: ReadonlySet<string> = new Set(OVERLAY_PARTS);
/** Proxy-only key: the overlay's internals, for `getOverlayTarget` / `observeOverlayConditions`. */
const OVERLAY_INTERNALS = Symbol('viewConditionsOverlay');

interface OverlayInternals {
  target: () => YDatabaseView;
  observe: (listener: () => void) => () => void;
  setSuspended: (suspended: boolean) => void;
}

function overlayInternals(view: YDatabaseView): OverlayInternals | undefined {
  return (view as unknown as Record<symbol, OverlayInternals | undefined>)[OVERLAY_INTERNALS];
}

/** The real view behind an overlay proxy; any other view is its own target. */
export function getOverlayTarget(view: YDatabaseView): YDatabaseView {
  return overlayInternals(view)?.target() ?? view;
}

/** Observe an overlay proxy's private filters and sorts (a no-op for a real view). */
export function observeOverlayConditions(view: YDatabaseView, listener: () => void): () => void {
  return overlayInternals(view)?.observe(listener) ?? (() => undefined);
}

/**
 * Suspend an overlay proxy for Edit mode, or resume it (see
 * `ViewConditionsOverlay.setSuspended`); a no-op for a real view.
 */
export function setOverlaySuspended(view: YDatabaseView, suspended: boolean) {
  overlayInternals(view)?.setSuspended(suspended);
}

type Plain = Record<string, unknown>;

/** Enum values that older clients, or earlier copies, stored as numeric strings. */
const ENUM_KEYS: ReadonlySet<string> = new Set([
  YjsDatabaseKey.condition,
  YjsDatabaseKey.filter_type,
  YjsDatabaseKey.type,
]);

function cloneInto(value: unknown): unknown {
  // Yjs can decode native BigInt values but cannot insert them into shared
  // types; the web dispatchers write enum values as numbers.
  if (typeof value === 'bigint') return Number(value);

  if (value instanceof Y.Map) {
    const map = new Y.Map();

    value.forEach((entry, key) => map.set(key, cloneInto(entry)));
    return map;
  }

  if (value instanceof Y.Array) {
    const array = new Y.Array();

    array.push(value.toArray().map(cloneInto));
    return array;
  }

  return value;
}

// Desktop-authored BigInts, their numeric-string copies and the numbers the
// web writes are the same condition, whatever order a client set its keys in.
const normalize = (key: string, value: unknown) => {
  if (typeof value === 'bigint') return Number(value);
  if (ENUM_KEYS.has(key) && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }

  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  }

  return value;
};

const sameJSON = (a: unknown, b: unknown) => JSON.stringify(a, normalize) === JSON.stringify(b, normalize);

function sameContents(a: Y.Array<unknown>, b: Y.Array<unknown> | undefined) {
  return sameJSON(a, b ?? []);
}

const conditionId = (value: unknown) => (value instanceof Y.Map ? value.get(YjsDatabaseKey.id) : undefined);

function reconcileMap(target: Y.Map<unknown>, source: Y.Map<unknown>) {
  Array.from(target.keys()).forEach((key) => {
    if (!source.has(key)) target.delete(key);
  });
  source.forEach((value, key) => {
    const current = target.get(key);

    if (current instanceof Y.Map && value instanceof Y.Map) reconcileMap(current, value);
    else if (current instanceof Y.Array && value instanceof Y.Array) replaceContents(current, value);
    else if (!target.has(key) || !sameJSON({ [key]: current }, { [key]: value })) target.set(key, cloneInto(value));
  });
}

/**
 * Makes `target` equal to `source`, keeping each condition map that is still
 * at its index: observers and collaborators then see only the changed keys.
 */
function replaceContents(target: Y.Array<unknown>, source: Y.Array<unknown> | undefined) {
  const next = source?.toArray() ?? [];

  next.forEach((value, index) => {
    if (index >= target.length) {
      target.push([cloneInto(value)]);
      return;
    }

    const current = target.get(index);

    if (current instanceof Y.Map && value instanceof Y.Map && conditionId(current) === conditionId(value)) {
      reconcileMap(current, value);
    } else if (!sameJSON(current, value)) {
      target.delete(index, 1);
      target.insert(index, [cloneInto(value)]);
    }
  });
  if (target.length > next.length) target.delete(next.length, target.length - next.length);
}

/** Whether two copies of a part (Y.Arrays or plain conditions) filter or sort the same way. */
function samePart(part: OverlayPart, local: unknown, real: Y.Array<unknown> | undefined) {
  return part === YjsDatabaseKey.filters ? sameFilters(local, real) : sameSorts(local, real);
}

const EMPTY_PARTS: ReadonlySet<OverlayPart> = new Set();

export function createViewConditionsOverlay(
  initialView: YDatabaseView,
  { initial }: ViewConditionsOverlayOptions = {}
): ViewConditionsOverlay {
  let realView = initialView;
  const localDoc = new Y.Doc();
  const local = localDoc.getMap('view');

  local.set(YjsDatabaseKey.filters, new Y.Array<unknown>());
  local.set(YjsDatabaseKey.sorts, new Y.Array<unknown>());

  let dirtyParts: ReadonlySet<OverlayPart> = EMPTY_PARTS;
  let destroyed = false;
  // Edit mode: the local arrays follow the real view and the dirty parts'
  // private copies wait here (plain conditions, by part) until it ends.
  let suspended = false;
  let setAside: PrivateWidgetEntry = {};
  const listeners = new Set<() => void>();
  const privateListeners = new Set<() => void>();
  // A dispatcher's writes to the local copy land in one transaction, like its
  // writes to the real doc, so local observers see only the final state.
  let unregisterLocalDoc = registerLocalConditionsDoc(initialView.doc as YDoc | null, localDoc);
  const setDirtyParts = (next: ReadonlySet<OverlayPart>) => {
    if (next.size === dirtyParts.size && [...next].every((part) => dirtyParts.has(part))) return;
    dirtyParts = next.size === 0 ? EMPTY_PARTS : next;
    listeners.forEach((listener) => listener());
  };

  const realArray = (key: string) => realView.get(key as YjsDatabaseKey.filters) as Y.Array<unknown> | undefined;
  const localArray = (key: string) => local.get(key) as Y.Array<unknown>;

  const mirror = (parts: readonly OverlayPart[]) => {
    if (parts.length === 0) return;
    localDoc.transact(() => {
      parts.forEach((key) => {
        const source = realArray(key);

        if (!sameContents(localArray(key), source)) replaceContents(localArray(key), source);
      });
    }, MIRROR_ORIGIN);
  };

  const cleanParts = () => OVERLAY_PARTS.filter((part) => !dirtyParts.has(part));

  // A part is the viewer's own while it differs from the real view; undoing a
  // change by hand (adding a filter, then deleting it) follows it again. While
  // suspended, the private copy of a dirty part is the one set aside.
  const partDiffers = (part: OverlayPart) =>
    !samePart(part, suspended && setAside[part] ? setAside[part] : localArray(part), realArray(part));
  const differingParts = (parts: readonly OverlayPart[]) => new Set(parts.filter(partDiffers));

  // While suspended, a write to the local arrays (a dispatcher writes through
  // the proxy) is a write to the real view: it runs inside the dispatcher's
  // transaction of the database doc (`registerLocalConditionsDoc`), so it is
  // part of the same action and undo step.
  const writeThrough = () => {
    const doc = realView.doc;

    if (!doc) return;
    doc.transact(() => {
      OVERLAY_PARTS.forEach((part) => {
        const source = localArray(part);
        let target = realArray(part);

        if (target && sameContents(source, target)) return;
        if (!target) {
          target = new Y.Array<unknown>();
          realView.set(part, target);
        }

        replaceContents(target, source);
      });
    });
  };

  // Local edits are anything that is not the mirror. Deep observation of the
  // map covers the arrays and their replacement.
  const onLocalChange = (_events: unknown, transaction: Y.Transaction) => {
    if (transaction.origin === MIRROR_ORIGIN) return;
    if (suspended) {
      writeThrough();
      return;
    }

    setDirtyParts(differingParts(OVERLAY_PARTS));
    privateListeners.forEach((listener) => listener());
  };

  local.observeDeep(onLocalChange);

  // The real view keeps feeding each part while the viewer has not changed it,
  // and every part while suspended.
  let detachReal: (() => void) | null = null;

  const followReal = () => mirror(suspended ? OVERLAY_PARTS : cleanParts());

  const onRealChange = () => {
    // A collaborator can make the real view match the viewer's copy of a part.
    if (dirtyParts.size > 0) {
      const differing = differingParts([...dirtyParts]);

      if (suspended) {
        const kept: PrivateWidgetEntry = {};

        differing.forEach((part) => {
          kept[part] = setAside[part];
        });
        setAside = kept;
      }

      setDirtyParts(differing);
    }

    followReal();
  };

  const attachReal = () => {
    detachReal?.();
    const attached = [...OVERLAY_KEYS].flatMap((key) => {
      const array = realArray(key);

      if (!array) return [];
      array.observeDeep(onRealChange);
      return [() => array.unobserveDeep(onRealChange)];
    });

    detachReal = () => attached.forEach((detach) => detach());
  };

  // A write that replaces the whole array (a save, a reset of the view) swaps the observed array.
  const onRealViewChange = (event: Y.YMapEvent<unknown>) => {
    if ([...OVERLAY_KEYS].some((key) => event.keysChanged.has(key))) {
      attachReal();
      onRealChange();
    }
  };

  realView.observe(onRealViewChange);
  attachReal();
  mirror(OVERLAY_PARTS);

  // Writes stored private parts into the local copy as the mirror does, so
  // no private-change listener runs. Returns the parts that differ from the
  // real view; the others follow it again.
  const writeParts = (entry: PrivateWidgetEntry, parts: readonly OverlayPart[]) => {
    localDoc.transact(() => {
      parts.forEach((part) => {
        const array = localArray(part);
        const items = (entry[part] as PlainCondition[]).map(plainToYCondition);

        if (array.length > 0) array.delete(0, array.length);
        if (items.length > 0) array.push(items);
      });
    }, MIRROR_ORIGIN);
    const differing = differingParts(parts);

    mirror(parts.filter((part) => !differing.has(part)));
    return differing;
  };

  // A restore from this device: the stored parts replace the mirrored ones
  // before anyone observes the copy (no listener runs).
  if (initial) {
    const restored = OVERLAY_PARTS.filter((part) => initial[part] !== undefined);

    if (restored.length > 0) dirtyParts = writeParts(initial, restored);
  }

  // The private copy of each dirty part, as plain conditions.
  const privateParts = (): PrivateWidgetEntry => {
    const entry: PrivateWidgetEntry = {};

    OVERLAY_PARTS.forEach((part) => {
      if (!dirtyParts.has(part)) return;
      entry[part] = suspended ? setAside[part] ?? [] : (localArray(part).toJSON() as PlainCondition[]);
    });
    return entry;
  };

  const setSuspended = (next: boolean) => {
    if (destroyed || next === suspended) return;

    if (next) {
      setAside = privateParts();
      suspended = true;
      // The dirty parts show the real view now; their observers see the change.
      mirror(OVERLAY_PARTS);
      return;
    }

    const parts = OVERLAY_PARTS.filter((part) => setAside[part] !== undefined);
    const entry = setAside;

    suspended = false;
    setAside = {};
    // The private copies come back; a part the real view now matches (an
    // edit made in Edit mode, a collaborator's) follows it again.
    setDirtyParts(writeParts(entry, parts));
  };

  const internals: OverlayInternals = {
    target: () => realView,
    observe: (listener) => {
      local.observeDeep(listener);
      return () => local.unobserveDeep(listener);
    },
    setSuspended,
  };

  const createProxy = () =>
    new Proxy(realView, {
      get(target, property, receiver) {
        if (property === OVERLAY_INTERNALS) return internals;
        if (property === 'get') {
          return (key: string) => (OVERLAY_KEYS.has(key) ? localArray(key) : target.get(key as YjsDatabaseKey.name));
        }

        if (property === 'set') {
          return (key: string, value: unknown) => {
            if (!OVERLAY_KEYS.has(key)) return target.set(key, value);
            // Integrate the given array into the local doc, so a caller that
            // keeps pushing into it (Yjs' usual "create, set, fill" pattern)
            // writes to the viewer's copy.
            localDoc.transact(() => local.set(key, value));
            return value;
          };
        }

        const value = Reflect.get(target, property, receiver);

        // Yjs methods must run against the real map, not the proxy.
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

  let view = createProxy();

  return {
    get view() {
      return view;
    },
    get realView() {
      return realView;
    },
    rebind(nextView) {
      if (destroyed || nextView === realView) return;
      realView.unobserve(onRealViewChange);
      if (nextView.doc !== realView.doc) {
        unregisterLocalDoc();
        unregisterLocalDoc = registerLocalConditionsDoc(nextView.doc as YDoc | null, localDoc);
      }

      realView = nextView;
      // A new proxy makes selectors resubscribe to the replacement's row
      // orders and settings; the local filter/sort arrays keep their identity.
      view = createProxy();
      realView.observe(onRealViewChange);
      attachReal();
      // Runs while a widget renders: the target swaps at once (reads go to
      // the replacement), but following its conditions writes the local doc
      // and notifies the nested database's subscriptions, which must not
      // happen inside a render. The dirty state (and its listeners) waits
      // for the next real change.
      queueMicrotask(() => {
        if (!destroyed) followReal();
      });
    },
    isDirty: () => dirtyParts.size > 0,
    dirtyParts: () => dirtyParts,
    setSuspended,
    isSuspended: () => suspended,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onPrivateChange(listener) {
      privateListeners.add(listener);
      return () => privateListeners.delete(listener);
    },
    reset() {
      if (destroyed) return;
      setAside = {};
      setDirtyParts(EMPTY_PARTS);
      mirror(OVERLAY_PARTS);
    },
    commit() {
      if (destroyed || dirtyParts.size === 0) return;
      const doc = realView.doc;
      const sharedRoot = doc?.getMap('data') as YSharedRoot | undefined;

      if (!doc || !sharedRoot) return;
      const parts = OVERLAY_PARTS.filter((part) => dirtyParts.has(part));

      // While suspended, the private copies are the ones set aside: the local
      // arrays take them first (the view shows the saved result right after).
      if (suspended) writeParts(privateParts(), parts);
      executeOperations(
        sharedRoot,
        [
          () => {
            // A clean part is never rewritten: its maps (and any keys another
            // client stored on them) stay as they are.
            parts.forEach((key) => {
              let target = realArray(key);

              if (!target) {
                target = new Y.Array<unknown>();
                realView.set(key, target);
              }

              replaceContents(target, localArray(key));
            });
          },
        ],
        'saveWidgetConditions'
      );
      setAside = {};
      setDirtyParts(EMPTY_PARTS);
      mirror(OVERLAY_PARTS);
    },
    restore(entry) {
      if (destroyed) return;
      const parts = OVERLAY_PARTS.filter((part) => entry[part] !== undefined && !dirtyParts.has(part));

      if (parts.length === 0) return;
      if (suspended) {
        // Set aside with the others; the local arrays keep following the real view.
        const restored: PrivateWidgetEntry = { ...setAside };

        parts.forEach((part) => {
          if (!samePart(part, entry[part], realArray(part))) restored[part] = entry[part];
        });
        setAside = restored;
        setDirtyParts(new Set(OVERLAY_PARTS.filter((part) => restored[part] !== undefined)));
        return;
      }

      const differing = writeParts(entry, parts);

      setDirtyParts(new Set([...dirtyParts, ...differing]));
    },
    exportPrivate() {
      if (dirtyParts.size === 0) return null;
      return privateParts();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unregisterLocalDoc();
      detachReal?.();
      realView.unobserve(onRealViewChange);
      local.unobserveDeep(onLocalChange);
      listeners.clear();
      privateListeners.clear();
      localDoc.destroy();
    },
  };
}

/** For tests and debugging: the plain filters / sorts the overlay currently holds. */
export function readOverlayConditions(overlay: ViewConditionsOverlay): { filters: Plain[]; sorts: Plain[] } {
  return {
    filters: (overlay.view.get(YjsDatabaseKey.filters) as Y.Array<unknown>).toJSON() as Plain[],
    sorts: (overlay.view.get(YjsDatabaseKey.sorts) as Y.Array<unknown>).toJSON() as Plain[],
  };
}
