import * as Y from 'yjs';

import { executeDatabaseOperations as executeOperations } from '@/application/database-yjs/history';
import { YDatabaseView, YjsDatabaseKey, YSharedRoot } from '@/application/types';

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
 * The local arrays mirror the real ones until the viewer's copy differs from
 * them ("dirty"); from then on the viewer's version wins until `reset()`,
 * `commit()`, or the two match again.
 */
export interface ViewConditionsOverlay {
  /** The proxy to hand to the nested database in place of the real view. */
  view: YDatabaseView;
  /** The current real view, including any replacement received from sync. */
  realView: YDatabaseView;
  /** Follow a replacement of the same source view, retaining private conditions. */
  rebind: (view: YDatabaseView) => void;
  isDirty: () => boolean;
  /** Notifies on every dirty-state change. */
  subscribe: (listener: () => void) => () => void;
  /** Drop the local changes and follow the real view again. */
  reset: () => void;
  /** Write the local filters and sorts to the real view (one undo step) and follow it again. */
  commit: () => void;
  destroy: () => void;
}

const MIRROR_ORIGIN = { overlay: 'mirror' };
const OVERLAY_KEYS: ReadonlySet<string> = new Set([YjsDatabaseKey.filters, YjsDatabaseKey.sorts]);
/** Proxy-only key: the overlay's internals, for `getOverlayTarget` / `observeOverlayConditions`. */
const OVERLAY_INTERNALS = Symbol('viewConditionsOverlay');

interface OverlayInternals {
  target: () => YDatabaseView;
  observe: (listener: () => void) => () => void;
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

type Plain = Record<string, unknown>;

function cloneInto(value: unknown): unknown {
  // Yjs can decode native BigInt values but cannot insert them into shared types.
  if (typeof value === 'bigint') return value.toString();

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

function replaceContents(target: Y.Array<unknown>, source: Y.Array<unknown> | undefined) {
  if (target.length > 0) target.delete(0, target.length);
  if (source && source.length > 0) target.push(source.toArray().map(cloneInto));
}

function sameContents(a: Y.Array<unknown>, b: Y.Array<unknown> | undefined) {
  // Compare native integers with the string values used when cloning them into Yjs.
  const replacer = (_key: string, value: unknown) => (typeof value === 'bigint' ? value.toString() : value);

  return JSON.stringify(a.toJSON(), replacer) === JSON.stringify(b?.toJSON() ?? [], replacer);
}

export function createViewConditionsOverlay(initialView: YDatabaseView): ViewConditionsOverlay {
  let realView = initialView;
  const localDoc = new Y.Doc();
  const local = localDoc.getMap('view');

  local.set(YjsDatabaseKey.filters, new Y.Array<unknown>());
  local.set(YjsDatabaseKey.sorts, new Y.Array<unknown>());

  let dirty = false;
  let destroyed = false;
  const listeners = new Set<() => void>();
  const setDirty = (next: boolean) => {
    if (dirty === next) return;
    dirty = next;
    listeners.forEach((listener) => listener());
  };

  const realArray = (key: string) => realView.get(key as YjsDatabaseKey.filters) as Y.Array<unknown> | undefined;
  const localArray = (key: string) => local.get(key) as Y.Array<unknown>;

  const mirror = () => {
    localDoc.transact(() => {
      OVERLAY_KEYS.forEach((key) => {
        const source = realArray(key);

        if (!sameContents(localArray(key), source)) replaceContents(localArray(key), source);
      });
    }, MIRROR_ORIGIN);
  };

  // The viewer's copy wins while it differs from the real view; undoing a
  // change by hand (adding a filter, then deleting it) follows it again.
  const differsFromReal = () => [...OVERLAY_KEYS].some((key) => !sameContents(localArray(key), realArray(key)));

  // Local edits are anything that is not the mirror. Deep observation of the
  // map covers the arrays and their replacement.
  const onLocalChange = (_events: unknown, transaction: Y.Transaction) => {
    if (transaction.origin !== MIRROR_ORIGIN) setDirty(differsFromReal());
  };

  local.observeDeep(onLocalChange);

  // The real view keeps feeding the copy while the viewer has no changes.
  let detachReal: (() => void) | null = null;

  const followReal = () => {
    if (!dirty) mirror();
  };

  const onRealChange = () => {
    // A collaborator can make the real view match the viewer's copy.
    if (dirty) setDirty(differsFromReal());
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
  mirror();

  const internals: OverlayInternals = {
    target: () => realView,
    observe: (listener) => {
      local.observeDeep(listener);
      return () => local.unobserveDeep(listener);
    },
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
    isDirty: () => dirty,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      if (destroyed) return;
      setDirty(false);
      mirror();
    },
    commit() {
      if (destroyed || !dirty) return;
      const doc = realView.doc;
      const sharedRoot = doc?.getMap('data') as YSharedRoot | undefined;

      if (!doc || !sharedRoot) return;
      executeOperations(
        sharedRoot,
        [
          () => {
            OVERLAY_KEYS.forEach((key) => {
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
      setDirty(false);
      mirror();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      detachReal?.();
      realView.unobserve(onRealViewChange);
      local.unobserveDeep(onLocalChange);
      listeners.clear();
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
