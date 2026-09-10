import { expect, type Page, type Route } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { generateRandomEmail } from '../../support/test-config';

const { Given, When, Then, After } = createBdd();
const ids = {
  space: '11111111-1111-4111-8111-111111111112',
  changed: '22222222-2222-4222-8222-222222222223',
  oldChild: '33333333-3333-4333-8333-333333333334',
  freshChild: '44444444-4444-4444-8444-444444444445',
  sibling: '55555555-5555-4555-8555-555555555556',
  siblingChild: '66666666-6666-4666-8666-666666666667',
  otherSpace: '77777777-7777-4777-8777-777777777778',
  otherChild: '88888888-8888-4888-8888-888888888889',
};

type SidebarView = {
  view_id: string;
  name: string;
  layout: number;
  icon: null;
  extra: { is_space: true } | null;
  children: SidebarView[];
  has_children: boolean;
  is_published: boolean;
  is_private: boolean;
};

type RefreshState = {
  email: string;
  refreshing: boolean;
  revoked: boolean;
  rootRequests: number;
  subtreeRequests: string[];
  release: () => void;
};

type ObservedWindow = Window & {
  __APPFLOWY_EVENT_EMITTER__?: { emit: (event: string, payload: unknown) => void };
  __sidebarPermissionObserver?: MutationObserver;
  __sidebarPermissionRows?: Element[];
  __sidebarPermissionRowsRemoved?: boolean;
};

const states = new WeakMap<Page, RefreshState>();

function view(viewId: string, name: string, children: SidebarView[] = [], space = false): SidebarView {
  return {
    view_id: viewId,
    name,
    layout: 0,
    icon: null,
    extra: space ? { is_space: true } : null,
    children,
    has_children: children.length > 0,
    is_published: false,
    is_private: false,
  };
}

async function respond(route: Route, data: unknown) {
  await route.fulfill({ json: { code: 0, message: 'success', data } });
}

Given('I have expanded sidebar branches for permission refresh testing', async ({ page, request }) => {
  const email = generateRandomEmail();

  await signInAndWaitForApp(page, request, email);
  const [, workspaceId, activeViewId] = new URL(page.url()).pathname.match(/\/app\/([^/]+)\/([^/?#]+)/) ?? [];

  expect(workspaceId).toBeTruthy();
  expect(activeViewId).toBeTruthy();
  let release!: () => void;
  const pendingRefresh = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state: RefreshState = {
    email,
    refreshing: false,
    revoked: false,
    rootRequests: 0,
    subtreeRequests: [],
    release,
  };

  states.set(page, state);
  const fixture = () => {
    const changedPage = view(ids.changed, state.refreshing ? 'Permission refreshed page' : 'Permission target', [
      state.refreshing
        ? view(ids.freshChild, 'Authorized child after refresh')
        : view(ids.oldChild, 'Previously cached child'),
    ]);

    return view(workspaceId, 'Workspace', [
      view(
        ids.space,
        'Permission fixture space',
        [
          view(activeViewId, 'Open page'),
          ...(state.revoked ? [] : [changedPage]),
          view(ids.sibling, 'Unaffected sibling', [view(ids.siblingChild, 'Unaffected nested child')]),
        ],
        true
      ),
      view(ids.otherSpace, 'Unaffected space', [view(ids.otherChild, 'Unaffected space child')], true),
    ]);
  };
  const shallowView = (viewId: string): SidebarView | undefined => {
    const find = (node: SidebarView): SidebarView | undefined =>
      node.view_id === viewId ? node : node.children.map(find).find(Boolean);
    const node = find(fixture());

    return node && { ...node, children: node.children.map((child) => ({ ...child, children: [] })) };
  };

  await page.route(`**/api/workspace/${workspaceId}/**`, async (route) => {
    const url = new URL(route.request().url());
    const prefix = `/api/workspace/${workspaceId}`;

    if (url.pathname === `${prefix}/view/${workspaceId}`) {
      if (state.refreshing) {
        state.rootRequests += 1;
        await pendingRefresh;
      }
      await respond(route, shallowView(workspaceId));
      return;
    }

    const batch = url.pathname === `${prefix}/views`;
    const singleId = url.pathname.match(/\/view\/([^/]+)$/)?.[1];
    const requestedIds = batch ? (url.searchParams.get('view_ids') ?? '').split(',') : singleId ? [singleId] : [];

    // Startup can batch cached navigation ancestors with fixture branches.
    // Serve the fixture IDs even when they share a request with a cached view.
    const fixtureIds = requestedIds.filter((id) => id === activeViewId || Object.values(ids).includes(id));

    if (fixtureIds.length) {
      if (state.refreshing) {
        state.subtreeRequests.push(...fixtureIds);
        await pendingRefresh;
      }
      const views = fixtureIds.map(shallowView);

      if (views.some((node) => !node)) {
        await route.fulfill({ json: { code: 1003, message: 'not enough permissions' } });
      } else {
        await respond(route, batch ? { views } : views[0]);
      }
      return;
    }

    if (url.pathname === `${prefix}/view/${ids.changed}/navigation`) {
      if (state.revoked) {
        await route.fulfill({ json: { code: 1003, message: 'not enough permissions' } });
      } else {
        await respond(route, shallowView(ids.changed));
      }
      return;
    }

    await route.continue();
  });

  await page.evaluate(
    (expandedIds) => {
      localStorage.setItem('outline_expanded', JSON.stringify(Object.fromEntries(expandedIds.map((id) => [id, true]))));
    },
    [ids.space, ids.changed, ids.sibling, ids.otherSpace]
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  for (const id of [ids.oldChild, ids.siblingChild, ids.otherChild]) {
    await expect(page.getByTestId(`page-${id}`)).toBeVisible({ timeout: 30000 });
  }

  // Track DOM identity throughout the event and delayed HTTP responses. Checking
  // only the final text would miss a branch disappearing and being recreated.
  await page.evaluate(
    (unaffectedIds) => {
      const win = window as ObservedWindow;
      win.__sidebarPermissionRows = unaffectedIds.map((id) => document.querySelector(`[data-testid="page-${id}"]`)!);
      win.__sidebarPermissionRowsRemoved = false;
      win.__sidebarPermissionObserver = new MutationObserver(() => {
        if (win.__sidebarPermissionRows?.some((row) => !row.isConnected)) win.__sidebarPermissionRowsRemoved = true;
      });
      win.__sidebarPermissionObserver.observe(document.body, { childList: true, subtree: true });
    },
    [ids.sibling, ids.siblingChild, ids.otherChild]
  );
});

When(
  'a remote {string} notification says the page access was {string}',
  async ({ page }, notification: string, access: string) => {
    const state = states.get(page)!;
    state.refreshing = true;
    state.revoked = access === 'revoked';
    await page.evaluate(
      ({ notification, email, viewId }) => {
        const emitter = (window as ObservedWindow).__APPFLOWY_EVENT_EMITTER__;
        if (!emitter) throw new Error('Workspace notification emitter is unavailable');
        emitter.emit(
          notification === 'permission' ? 'permission-changed' : 'share-views-changed',
          notification === 'permission' ? { objectId: viewId } : { viewId, emails: [email] }
        );
      },
      { notification, email: state.email, viewId: ids.changed }
    );
  }
);

Then('unrelated sidebar branches stay mounted while permission refresh is pending', async ({ page }) => {
  await expect.poll(() => states.get(page)!.rootRequests).toBeGreaterThan(0);
  await expect(page.getByTestId(`page-${ids.oldChild}`)).toHaveCount(0);
  for (const id of [ids.siblingChild, ids.otherChild]) {
    await expect(page.getByTestId(`page-${id}`)).toBeVisible();
  }
  expect(await page.evaluate(() => (window as ObservedWindow).__sidebarPermissionRowsRemoved)).toBe(false);
});

When('the sidebar permission refresh finishes', async ({ page }) => {
  states.get(page)!.release();
});

Then(
  'the sidebar reflects the {string} page access without remounting unrelated branches',
  async ({ page }, access: string) => {
    if (access === 'revoked') {
      await expect(page.getByTestId(`page-${ids.changed}`)).toHaveCount(0);
    } else {
      await expect(page.getByTestId(`page-${ids.changed}`)).toContainText('Permission refreshed page');
      await expect(page.getByTestId(`page-${ids.freshChild}`)).toBeVisible();
    }
    expect(await page.evaluate(() => (window as ObservedWindow).__sidebarPermissionRowsRemoved)).toBe(false);
    expect(states.get(page)!.subtreeRequests).not.toEqual(expect.arrayContaining([ids.sibling]));
    expect(states.get(page)!.subtreeRequests).not.toEqual(expect.arrayContaining([ids.otherSpace]));
  }
);

After({ tags: '@sidebar-permission-refresh' }, async ({ page }) => {
  states.get(page)?.release();
  states.delete(page);
  await page.unrouteAll({ behavior: 'wait' });
  await page.evaluate(() => (window as ObservedWindow).__sidebarPermissionObserver?.disconnect());
});
