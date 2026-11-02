import { expect, type APIRequestContext, type Page } from '@playwright/test';
import * as Y from 'yjs';

import { canonicalJson, plainYjs, readServerDatabaseDoc } from './dashboard-shared-helpers';
import {
  dashboardWorld,
  readViewConditions,
  waitForDashboardSync,
  waitForDatabaseContext,
} from './dashboard-test-helpers';

type ViewConditions = Awaited<ReturnType<typeof readViewConditions>>;

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

  const access = { token: world.owner.accessToken, workspaceId: world.workspaceId };

  for (const [databaseId, expectedViews] of sources) {
    // Poll for 'synced' or a description of the mismatch, so a timeout says what differed. A
    // transient server error means "not yet", like waitForDashboardSync.
    await expect
      .poll(
        () =>
          readServerDatabaseDoc(request, access, databaseId, (database) => {
            const views = database?.get('views') as Y.Map<Y.Map<unknown>> | undefined;

            for (const [viewId, expected] of expectedViews) {
              const view = views?.get(viewId);

              if (!view) return `view ${viewId} is missing on the server`;
              const plain = (key: string) => plainYjs(view.get(key)) ?? [];
              const remote = canonicalJson({ filters: plain('filters'), sorts: plain('sorts') });
              const local = canonicalJson(expected);

              if (remote !== local) return `view ${viewId}: server ${remote} != browser ${local}`;
            }

            return 'synced';
          }).catch((error: Error) => `server read failed: ${error.message}`),
        { timeout: 45_000, message: `waiting for source ${databaseId} filters and sorts to reach the server` }
      )
      .toBe('synced');
  }
}
