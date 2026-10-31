/**
 * The folder metadata (name, icon, layout) of a dashboard's widget views, in
 * one request per dashboard open instead of one per widget (performance
 * report W25).
 *
 * Every widget header asks for its view's metadata when it mounts, all in the
 * same commit. A batcher collects the views asked for in one tick and reads
 * them with the batched folder request the deletion probe sends too
 * (`ViewService.getMultiple`, `GET /views?depth=1&view_ids=…`). The app's
 * `loadViewMeta` stays in charge of everything else:
 *
 * - a view in the flat metadata index (the outline fills it, folder events
 *   keep it current) is read from there with `metadataOnly`, without a
 *   request; the plain per-view load would ask the server for it;
 * - a view in the app's view cache is answered by the per-view load from it;
 * - a tick that asks for fewer than two other views uses the per-view load;
 * - a view the batch leaves out (deleted, no access) and every view of a
 *   failed batch fall back to the per-view load, so its own answer (and its
 *   retries) decide.
 *
 * The app's load keeps its own checks (a view in the trash is refused) for
 * every view it answers; a view the batch answers is shown as the server
 * returns it.
 *
 * Renames are not this module's concern: `useWidgetViewMeta` follows them
 * through the app's event emitter. No React here.
 */
import { ViewService } from '@/application/services/domains';
import { LoadViewMeta, View } from '@/application/types';

/** The batched folder read: the views of `viewIds` that could be read, in any order, the others left out. */
export type FetchViews = (workspaceId: string, viewIds: string[], depth: number) => Promise<View[]>;

export interface ViewMetaBatcherOptions {
  workspaceId: string;
  /** The per-view metadata load: the answer for a view the app holds, and the fallback. */
  loadViewMeta: LoadViewMeta;
  /** Default: `ViewService.getMultiple`. */
  fetchViews?: FetchViews;
  /** What the app holds of `viewId` already. Default: `knownViewMeta`. */
  known?: (workspaceId: string, viewId: string) => KnownViewMeta;
}

/**
 * - `metadata`: the flat metadata index holds the view (`metadataOnly` reads it);
 * - `view`: the app's view cache holds it (the per-view load reads it);
 * - `null`: neither; the server must be asked.
 */
export type KnownViewMeta = 'metadata' | 'view' | null;

export interface ViewMetaBatcher {
  readonly workspaceId: string;
  /**
   * A drop-in `loadViewMeta`: the lookups of one tick share one batched
   * request. A call with options (metadata-only, authoritative) is passed to
   * the per-view load unchanged. Stable.
   */
  readonly loadViewMeta: LoadViewMeta;
}

/** The depth of the per-view request (`GET /view/{id}?depth=1`) this replaces. */
const META_DEPTH = 1;

export function knownViewMeta(workspaceId: string, viewId: string): KnownViewMeta {
  if (ViewService.getCachedMetadata(workspaceId, viewId) !== undefined) return 'metadata';
  if (ViewService.getCached(workspaceId, viewId) !== undefined) return 'view';
  return null;
}

/** Reads the flat metadata index through the app's load: no request, the app's checks kept. */
const FROM_METADATA_INDEX = { metadataOnly: true } as const;

interface PendingLookup {
  viewId: string;
  resolve: (view: View | null) => void;
  reject: (error: unknown) => void;
}

export function createViewMetaBatcher({
  workspaceId,
  loadViewMeta,
  fetchViews = ViewService.getMultiple,
  known = knownViewMeta,
}: ViewMetaBatcherOptions): ViewMetaBatcher {
  let pending: PendingLookup[] = [];

  const flush = () => {
    const lookups = pending;

    pending = [];

    const viewIds = Array.from(new Set(lookups.map((lookup) => lookup.viewId)));
    const knownAs = new Map(viewIds.map((viewId) => [viewId, known(workspaceId, viewId)]));
    // One load per view through the app, shared by the lookups of this tick.
    const alone = new Map<string, Promise<View | null>>();
    const loadAlone = (viewId: string) => {
      let load = alone.get(viewId);

      if (!load) {
        load =
          knownAs.get(viewId) === 'metadata'
            ? loadViewMeta(viewId, undefined, FROM_METADATA_INDEX)
            : loadViewMeta(viewId);
        alone.set(viewId, load);
      }

      return load;
    };

    const settle = (batched: Map<string, View>) => {
      lookups.forEach(({ viewId, resolve, reject }) => {
        const view = batched.get(viewId);

        if (view) resolve(view);
        else loadAlone(viewId).then(resolve, reject);
      });
    };

    const unknown = viewIds.filter((viewId) => knownAs.get(viewId) === null);

    if (unknown.length < 2) {
      settle(new Map());
      return;
    }

    fetchViews(workspaceId, unknown, META_DEPTH).then(
      (views) => {
        const requested = new Set(unknown);

        settle(new Map(views.filter((view) => requested.has(view.view_id)).map((view) => [view.view_id, view])));
      },
      () => settle(new Map())
    );
  };

  const load = (viewId: string) =>
    new Promise<View | null>((resolve, reject) => {
      if (pending.length === 0) queueMicrotask(flush);
      pending.push({ viewId, resolve, reject });
    });

  return {
    workspaceId,
    loadViewMeta: (viewId, onChange, options) => {
      if (options) return loadViewMeta(viewId, onChange, options);

      return load(viewId).then((view) => {
        onChange?.(view);
        return view;
      });
    },
  };
}

/** One batcher per dashboard: its host's `loadViewMeta` is one stable function per open dashboard. */
const batchers = new WeakMap<LoadViewMeta, ViewMetaBatcher>();

/**
 * The batched `loadViewMeta` of the dashboard whose host load is
 * `loadViewMeta`, created on first use and shared by every widget of that
 * dashboard.
 */
export function dashboardViewMetaLoader(loadViewMeta: LoadViewMeta, workspaceId: string): LoadViewMeta {
  let batcher = batchers.get(loadViewMeta);

  if (!batcher || batcher.workspaceId !== workspaceId) {
    batcher = createViewMetaBatcher({ workspaceId, loadViewMeta });
    batchers.set(loadViewMeta, batcher);
  }

  return batcher.loadViewMeta;
}
