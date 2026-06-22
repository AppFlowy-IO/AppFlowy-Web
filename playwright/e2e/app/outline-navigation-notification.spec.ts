import { test, expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { PageSelectors, SpaceSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

const VIEW_LAYOUT_DOCUMENT = 0;
const spaceId = '11111111-1111-4111-8111-111111111111';
const rootId = '22222222-2222-4222-8222-222222222222';
const parentId = '33333333-3333-4333-8333-333333333333';
const targetId = '44444444-4444-4444-8444-444444444444';
const rootSiblingId = '55555555-5555-4555-8555-555555555555';
const targetSiblingId = '66666666-6666-4666-8666-666666666666';
const initialViewId = '77777777-7777-4777-8777-777777777777';

type SidebarView = {
  folder_rid?: string;
  view_id: string;
  name: string;
  icon: null;
  layout: number;
  extra: Record<string, unknown> | null;
  children: SidebarView[];
  has_children?: boolean;
  is_published: boolean;
  is_private: boolean;
  parent_view_id?: string;
};

const simpleDocument = JSON.parse(readFileSync(new URL('../../fixtures/simple_doc.json', import.meta.url), 'utf8')) as {
  data: {
    doc_state: number[];
  };
};

function createView(viewId: string, overrides: Partial<SidebarView> = {}): SidebarView {
  return {
    view_id: viewId,
    name: overrides.name ?? viewId,
    icon: null,
    layout: VIEW_LAYOUT_DOCUMENT,
    extra: overrides.extra ?? null,
    children: overrides.children ?? [],
    has_children: overrides.has_children,
    is_published: false,
    is_private: false,
    parent_view_id: overrides.parent_view_id,
    ...overrides,
  };
}

function apiResponse(data: unknown) {
  return {
    code: 0,
    data,
    message: 'success',
  };
}

async function fulfillJson(route: Route, data: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(apiResponse(data)),
  });
}

function extractWorkspaceId(page: Page): string {
  const match = new URL(page.url()).pathname.match(/\/app\/([^/?#]+)/);

  if (!match?.[1]) {
    throw new Error(`Unable to extract workspace id from URL: ${page.url()}`);
  }

  return match[1];
}

async function installNavigationFixture(page: Page, workspaceId: string, options: { denyTargetAccess?: boolean } = {}) {
  const targetView = createView(targetId, {
    name: 'Mention target',
    parent_view_id: parentId,
  });
  const initialView = createView(initialViewId, {
    name: 'Initial cached page',
    parent_view_id: spaceId,
  });

  const shallowWorkspaceRoot = createView(workspaceId, {
    folder_rid: 'outline-navigation-playwright-1',
    children: [
      createView(spaceId, {
        name: 'Navigation fixture space',
        extra: {
          is_space: true,
          space_icon: '',
          space_icon_color: '',
        },
        has_children: true,
        children: [initialView],
      }),
    ],
  });

  const navigationRoot = createView(spaceId, {
    name: 'Navigation fixture space',
    extra: {
      is_space: true,
      space_icon: '',
      space_icon_color: '',
    },
    has_children: true,
    children: [
      createView(rootId, {
        name: 'Root view',
        has_children: true,
        parent_view_id: spaceId,
        children: [
          createView(parentId, {
            name: 'Parent view',
            has_children: true,
            parent_view_id: rootId,
            children: [
              targetView,
              createView(targetSiblingId, {
                name: 'Target sibling',
                parent_view_id: parentId,
              }),
            ],
          }),
        ],
      }),
      createView(rootSiblingId, {
        name: 'Root sibling',
        has_children: true,
        parent_view_id: spaceId,
      }),
    ],
  });
  const mentionNotification = {
    id: 'outline-navigation-mention-notification',
    workspace_id: workspaceId,
    type: 'mention',
    view_id: targetId,
    actor_uid: 1,
    metadata: {
      actor_name: 'Navigation Tester',
      page_name: 'Mention target',
      page_path: 'Root view / Parent view / Mention target',
    },
    is_read: false,
    is_archived: false,
    created_at: new Date().toISOString(),
    read_at: null,
  };

  await page.route('**/api/workspace/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (request.method() === 'GET' && pathname === `/api/workspace/${workspaceId}/view/${workspaceId}`) {
      await fulfillJson(route, shallowWorkspaceRoot);
      return;
    }

    if (request.method() === 'GET' && pathname === `/api/workspace/${workspaceId}/notifications/unread-count`) {
      await fulfillJson(route, {
        unread_count: 1,
      });
      return;
    }

    if (request.method() === 'GET' && pathname === `/api/workspace/${workspaceId}/notifications`) {
      await fulfillJson(route, {
        notifications: url.searchParams.get('archived') === 'true' ? [] : [mentionNotification],
        has_more: false,
      });
      return;
    }

    if (request.method() === 'GET' && pathname === `/api/workspace/${workspaceId}/view/${targetId}/navigation`) {
      if (options.denyTargetAccess) {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 403,
            message: 'not enough permissions',
          }),
        });
        return;
      }

      await fulfillJson(route, navigationRoot);
      return;
    }

    if (request.method() === 'GET' && pathname === `/api/workspace/${workspaceId}/view/${targetId}`) {
      if (options.denyTargetAccess) {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 403,
            message: 'not enough permissions',
          }),
        });
        return;
      }

      await fulfillJson(route, targetView);
      return;
    }

    if (request.method() === 'GET' && pathname === `/api/workspace/${workspaceId}/view/${initialViewId}`) {
      await fulfillJson(route, initialView);
      return;
    }

    if (request.method() === 'GET' && pathname === `/api/workspace/${workspaceId}/page-view/${targetId}`) {
      await fulfillJson(route, {
        view: targetView,
        data: {
          encoded_collab: simpleDocument.data.doc_state,
          row_data: {},
        },
      });
      return;
    }

    if (request.method() === 'GET' && pathname === `/api/workspace/${workspaceId}/page-view/${initialViewId}`) {
      await fulfillJson(route, {
        view: initialView,
        data: {
          encoded_collab: simpleDocument.data.doc_state,
          row_data: {},
        },
      });
      return;
    }

    if (request.method() === 'POST' && pathname === `/api/workspace/${workspaceId}/add-recent-pages`) {
      await fulfillJson(route, null);
      return;
    }

    if (request.method() === 'POST' && pathname === `/api/workspace/${workspaceId}/notifications/read`) {
      await fulfillJson(route, null);
      return;
    }

    await route.continue();
  });
}

test.describe('Outline navigation from notification', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('View not found') ||
        err.message.includes('WebSocket') ||
        err.message.includes('connection') ||
        err.message.includes('ResizeObserver loop') ||
        err.message.includes('Non-Error promise rejection')
      ) {
        return;
      }

      throw err;
    });
  });

  async function openMentionNotification(page: Page, workspaceId: string) {
    await page.goto(`/app/${workspaceId}/${initialViewId}`, { waitUntil: 'domcontentloaded' });
    await expect(SpaceSelectors.names(page).filter({ hasText: 'Navigation fixture space' })).toBeVisible({
      timeout: 30000,
    });
    await expect(PageSelectors.nameContaining(page, 'Mention target')).toHaveCount(0);

    await page
      .getByRole('button', {
        name: /notifications|settings\.notifications\.titles\.notifications/i,
      })
      .click();
    await expect(page.getByText('Mentioned You')).toBeVisible({ timeout: 30000 });

    const navigationRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());

      return request.method() === 'GET' && url.pathname === `/api/workspace/${workspaceId}/view/${targetId}/navigation`;
    });

    await page.getByRole('button').filter({ hasText: 'Mention target' }).first().click();
    await navigationRequest;
  }

  test('opens a deep target from a mention notification and expands sidebar context', async ({ page, request }) => {
    await signInAndWaitForApp(page, request, generateRandomEmail());

    const workspaceId = extractWorkspaceId(page);

    await installNavigationFixture(page, workspaceId);
    await page.evaluate(() => {
      window.localStorage.removeItem('outline_expanded');
    });

    await openMentionNotification(page, workspaceId);
    await expect(page).toHaveURL(new RegExp(`/app/${workspaceId}/${targetId}`));

    await expect(PageSelectors.nameContaining(page, 'Mention target')).toBeVisible({ timeout: 30000 });
    await expect(PageSelectors.nameContaining(page, 'Parent view')).toBeVisible();
    await expect(PageSelectors.nameContaining(page, 'Target sibling')).toBeVisible();
    await expect(PageSelectors.nameContaining(page, 'Root sibling')).toBeVisible();
    await expect(PageSelectors.pageByViewId(page, targetId)).toHaveAttribute('data-selected', 'true');

    await expect
      .poll(async () => {
        return page.evaluate(
          ([spaceViewId, rootViewId, parentViewId]) => {
            const expanded = JSON.parse(window.localStorage.getItem('outline_expanded') || '{}') as Record<
              string,
              boolean
            >;

            return [expanded[spaceViewId], expanded[rootViewId], expanded[parentViewId]];
          },
          [spaceId, rootId, parentId]
        );
      })
      .toEqual([true, true, true]);
  });

  test('keeps the sidebar closed when the notification target is denied by navigation API', async ({
    page,
    request,
  }) => {
    await signInAndWaitForApp(page, request, generateRandomEmail());

    const workspaceId = extractWorkspaceId(page);

    await installNavigationFixture(page, workspaceId, { denyTargetAccess: true });
    await page.evaluate(() => {
      window.localStorage.removeItem('outline_expanded');
    });

    await openMentionNotification(page, workspaceId);

    await expect(PageSelectors.nameContaining(page, 'Mention target')).toHaveCount(0);
    await expect
      .poll(async () => {
        return page.evaluate(
          ([spaceViewId, rootViewId, parentViewId]) => {
            const expanded = JSON.parse(window.localStorage.getItem('outline_expanded') || '{}') as Record<
              string,
              boolean
            >;

            return [expanded[spaceViewId], expanded[rootViewId], expanded[parentViewId]];
          },
          [spaceId, rootId, parentId]
        );
      })
      .toEqual([undefined, undefined, undefined]);
  });
});
