import { expect, type APIRequestContext, type Page } from '@playwright/test';
import * as Y from 'yjs';

import { Types } from '../../src/application/types';

import {
  apiGet,
  dashboardWorld,
  readViewConditions,
  waitForDashboardSync,
  waitForDatabaseContext,
} from './dashboard-test-helpers';

type ViewConditions = Awaited<ReturnType<typeof readViewConditions>>;

/** Yrs may encode map keys in a different order; condition array order matters. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : item
  );
}

/** Verify the persisted source documents, not just the browser's shared Y.Doc. */
export async function waitForDashboardConditionsSync(page: Page, request: APIRequestContext) {
  await waitForDashboardSync(page, request);
  const world = dashboardWorld(page);
  const sources = new Map<string, Map<string, ViewConditions>>();

  for (const widget of Object.values(world.widgets)) {
    let views = sources.get(widget.databaseId);

    if (!views) {
      views = new Map();
      sources.set(widget.databaseId, views);
    }

    if (!views.has(widget.viewId)) {
      await waitForDatabaseContext(page, widget.databaseId);
      views.set(widget.viewId, await readViewConditions(page, widget.viewId));
    }
  }

  for (const [databaseId, expectedViews] of sources) {
    // Poll for 'synced' or a description of the mismatch, so a timeout says what differed.
    await expect
      .poll(
        async () => {
          // A transient server error means "not yet", like waitForDashboardSync.
          const collab = await apiGet<{ doc_state: number[] }>(
            request,
            world.owner.accessToken,
            `/api/workspace/v1/${world.workspaceId}/collab/${databaseId}?collab_type=${Types.Database}`
          ).catch((error: Error) => error.message);

          if (typeof collab === 'string') return `server read failed: ${collab}`;
          const doc = new Y.Doc({ guid: databaseId });

          try {
            Y.applyUpdate(doc, new Uint8Array(collab.doc_state));
            const database = doc.getMap('data').get('database') as Y.Map<unknown> | undefined;
            const views = database?.get('views') as Y.Map<Y.Map<unknown>> | undefined;

            for (const [viewId, expected] of expectedViews) {
              const view = views?.get(viewId);

              if (!view) return `view ${viewId} is missing on the server`;
              const plain = (key: string) => {
                const value = view.get(key);

                return value instanceof Y.Array || value instanceof Y.Map ? value.toJSON() : value ?? [];
              };
              const remote = canonicalJson({ filters: plain('filters'), sorts: plain('sorts') });
              const local = canonicalJson(expected);

              if (remote !== local) return `view ${viewId}: server ${remote} != browser ${local}`;
            }

            return 'synced';
          } finally {
            doc.destroy();
          }
        },
        { timeout: 45_000, message: `waiting for source ${databaseId} filters and sorts to reach the server` }
      )
      .toBe('synced');
  }
}
