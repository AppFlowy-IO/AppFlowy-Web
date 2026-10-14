import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { createConfirmedPasswordUser } from '../../support/auth-utils';
import { grantTestWorkspaceProSubscription } from '../../support/subscription-test-helpers';
import { TestConfig } from '../../support/test-config';

type ViewNode = {
  view_id: string;
  parent_view_id?: string;
  access_level?: number;
  name?: string;
  children: ViewNode[];
};

async function successful<T>(response: Pick<APIResponse, 'ok' | 'status' | 'json'>, operation: string): Promise<T> {
  expect(response.ok(), `${operation}: HTTP ${response.status()}`).toBe(true);
  const body = await response.json();

  // Do not include auth responses or tokens in test artifacts.
  expect(body.code, `${operation}: ${body.message ?? ''}`).toBe(0);
  return body.data as T;
}

async function createAccount(request: APIRequestContext, email: string, password: string) {
  await createConfirmedPasswordUser(request, email, password);
  const login = async () => {
    const response = await request.post(`${TestConfig.gotrueUrl}/token?grant_type=password`, {
      data: { email, password },
    });

    expect(response.ok(), `Password sign-in: HTTP ${response.status()}`).toBe(true);
    const body = await response.json();

    expect(typeof body.access_token).toBe('string');
    return body.access_token as string;
  };

  const token = await login();

  await successful(await request.get(`${TestConfig.apiUrl}/api/user/verify/${token}`), 'Register local test user');
  // Verification may consume the login session; use a new one for fixture requests.
  return login();
}

function findView(root: ViewNode, id: string): ViewNode | undefined {
  if (root.view_id === id) return root;
  for (const child of root.children ?? []) {
    const found = findView(child, id);

    if (found) return found;
  }
}

for (const scenario of [
  { label: 'Full Access', accessLevel: 50, canWrite: true },
  { label: 'Read Only', accessLevel: 10, canWrite: false },
]) {
  test(`member with ${scenario.label} to a private-space document ${
    scenario.canWrite ? 'can' : 'cannot'
  } add a subpage from Shared with me`, async ({ page, request }, testInfo) => {
    test.setTimeout(180_000);
    const runId = randomUUID();
    const password = `C12-repro-${randomUUID()}!`;
    const ownerEmail = `c12-owner-${runId}@example.test`;
    const memberEmail = `c12-member-${runId}@example.test`;
    const ownerToken = await createAccount(request, ownerEmail, password);
    const memberToken = await createAccount(request, memberEmail, password);
    const ownerHeaders = { Authorization: `Bearer ${ownerToken}` };
    const memberHeaders = { Authorization: `Bearer ${memberToken}` };
    const ownerInfo = await successful<{ visiting_workspace: { workspace_id: string } }>(
      await request.get(`${TestConfig.apiUrl}/api/user/workspace`, { headers: ownerHeaders }),
      'Read owner workspace'
    );
    const workspaceId = ownerInfo.visiting_workspace.workspace_id;
    const workspaceUrl = `${TestConfig.apiUrl}/api/workspace/${workspaceId}`;

    // Use the existing CI fixture entitlement so the hosted Free-plan member
    // limit cannot block setup. Only this newly created workspace is changed.
    grantTestWorkspaceProSubscription(workspaceId);

    await successful(
      await request.post(`${workspaceUrl}/invite`, {
        headers: ownerHeaders,
        data: [{ email: memberEmail, role: 'Member', auto_accept: true, skip_email_send: true }],
      }),
      'Invite regular workspace member'
    );
    const memberInfo = await successful<{ workspaces: { workspace_id: string; role: string }[] }>(
      await request.get(`${TestConfig.apiUrl}/api/user/workspace`, { headers: memberHeaders }),
      'Verify workspace membership'
    );

    expect(memberInfo.workspaces.find((workspace) => workspace.workspace_id === workspaceId)?.role).toBe('Member');
    const privateSpace = await successful<{ view_id: string }>(
      await request.post(`${workspaceUrl}/spaces`, {
        headers: ownerHeaders,
        data: {
          name: 'C12 private space',
          space_icon: '',
          space_icon_color: '',
          permission: { visibility: 'private' },
        },
      }),
      'Create owner-only private space'
    );
    const createDocument = async (token: string, parentId: string, name: string) => {
      const viewId = randomUUID();
      const requestId = randomUUID();
      // Use the same atomic default-document endpoint as current PageService.add.
      const data = {
        schema_version: 'v1',
        request_id: requestId,
        view_id: viewId,
        parent_view_id: parentId,
        position: { kind: 'start' },
        name,
      };

      for (let attempt = 0; attempt < 16; attempt++) {
        const response = await request.post(`${workspaceUrl}/v2/page-view/document/default`, {
          headers: { Authorization: `Bearer ${token}` },
          data,
        });

        // Current Web retries explicit RetryLater with the exact same request.
        // Permission failures and other errors must fail the fixture immediately.
        if (response.ok() && (await response.json()).code === -5 && attempt < 15) {
          await delay(500);
          continue;
        }

        const receipt = await successful<{ request_id: string; result: { view_id: string } }>(
          response,
          `Create ${name}`
        );

        expect(receipt.request_id).toBe(requestId);
        expect(receipt.result.view_id).toBe(viewId);
        return receipt.result;
      }

      throw new Error('Document creation exhausted its retry budget');
    };

    const parent = await createDocument(ownerToken, privateSpace.view_id, 'C12 shared document');
    const sibling = await createDocument(ownerToken, privateSpace.view_id, 'Owner-only sibling');

    await successful(
      await request.put(`${TestConfig.apiUrl}/api/sharing/workspace/${workspaceId}/view`, {
        headers: ownerHeaders,
        data: { view_id: parent.view_id, emails: [memberEmail], access_level: scenario.accessLevel, auto_confirm: true },
      }),
      `Share only the document with ${scenario.label}`
    );
    const permission = await successful<{ can_read: boolean; can_write: boolean }>(
      await request.get(`${workspaceUrl}/collab/${parent.view_id}/permission?collab_type=0`, {
        headers: memberHeaders,
      }),
      'Read canonical document permission'
    );

    expect(permission).toMatchObject({ can_read: true, can_write: scenario.canWrite });

    // The write case proves page-only permission is sufficient at the real API.
    // The read case gets an owner-created child so both projections have the same shape.
    const child = await createDocument(
      scenario.canWrite ? memberToken : ownerToken,
      parent.view_id,
      scenario.canWrite ? 'Member-created API control' : 'Owner-created read-only child'
    );
    const canonicalParent = await successful<ViewNode>(
      await request.get(`${workspaceUrl}/view/${parent.view_id}?depth=2`, { headers: ownerHeaders }),
      'Read canonical parent as owner'
    );

    expect(canonicalParent.parent_view_id).toBe(privateSpace.view_id);
    expect(findView(canonicalParent, child.view_id)?.parent_view_id).toBe(parent.view_id);
    const sharedTree = await successful<ViewNode>(
      await request.get(`${TestConfig.apiUrl}/api/sharing/workspace/${workspaceId}/view/${workspaceId}?depth=50`, {
        headers: memberHeaders,
      }),
      'Read member Shared with me projection'
    );

    expect(findView(sharedTree, parent.view_id)).toMatchObject({
      access_level: scenario.accessLevel,
      parent_view_id: workspaceId,
    });
    expect(findView(sharedTree, child.view_id)?.parent_view_id).toBe(parent.view_id);
    expect(findView(sharedTree, privateSpace.view_id)).toBeUndefined();
    expect(findView(sharedTree, sibling.view_id)).toBeUndefined();
    for (const viewId of [privateSpace.view_id, sibling.view_id]) {
      const response = await request.get(`${workspaceUrl}/view/${viewId}`, { headers: memberHeaders });
      const body = await response.json();

      expect(body.code, 'Creating a child must not grant access to the private space or its unrelated pages').toBe(1012);
    }

    const evidencePath = testInfo.outputPath('fixture-and-permissions.json');

    await writeFile(
      evidencePath,
      JSON.stringify({ workspaceId, privateSpace, parent, child, sibling, permission, sharedTree }, null, 2)
    );
    await testInfo.attach('fixture-and-permissions', {
      path: evidencePath,
      contentType: 'application/json',
    });

    await signInWithPasswordViaUi(page, memberEmail, password);
    await page.goto(`/app/${workspaceId}/${parent.view_id}`);
    await expect(page.locator(`#editor-${parent.view_id}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Shared with me', { exact: true })).toBeVisible();
    await expect(page.getByTestId(`space-${privateSpace.view_id}`)).toHaveCount(0);
    await expect(page.getByTestId(`page-${sibling.view_id}`)).toHaveCount(0);
    const sharedRow = page.getByTestId(`page-${parent.view_id}`);
    const expandSidebarRow = async (viewId: string) => {
      const row = page.getByTestId(`page-${viewId}`);

      await expect(row).toBeVisible();
      const expand = row.getByTestId('outline-toggle-expand');

      if (await expand.isVisible()) await expand.click();
      await expect(row.getByTestId('outline-toggle-collapse')).toBeVisible();
    };

    await expect(sharedRow).toBeVisible();
    await expandSidebarRow(parent.view_id);
    await expect(page.getByTestId(`page-${child.view_id}`)).toBeVisible();
    await sharedRow.hover();
    const saveScreenshot = async (name: string) => {
      const path = testInfo.outputPath(`${name}.png`);

      await writeFile(path, await page.screenshot());
      await testInfo.attach(name, { path, contentType: 'image/png' });
    };

    if (!scenario.canWrite) {
      await expect(sharedRow.getByTestId('inline-add-page')).toHaveCount(0);
      await saveScreenshot('read-only-shared-document-without-add-action');
      const deniedViewId = randomUUID();
      const response = await request.post(`${workspaceUrl}/v2/page-view/document/default`, {
        headers: memberHeaders,
        data: {
          schema_version: 'v1',
          request_id: randomUUID(),
          view_id: deniedViewId,
          parent_view_id: parent.view_id,
          position: { kind: 'start' },
          name: 'Must not be created by read-only member',
        },
      });

      expect((await response.json()).code, 'Read-only sharing must not authorize direct child creation').toBe(1012);
      const unchangedParent = await successful<ViewNode>(
        await request.get(`${workspaceUrl}/view/${parent.view_id}?depth=2`, { headers: ownerHeaders }),
        'Verify rejected creation did not add a child'
      );

      expect(findView(unchangedParent, deniedViewId)).toBeUndefined();
      expect(unchangedParent.children.map((view) => view.view_id)).toEqual([child.view_id]);
      return;
    }

    const addButton = sharedRow.getByTestId('inline-add-page');

    await expect(addButton, 'Full Access to the shared document should expose its add-subpage action').toBeVisible();
    await saveScreenshot('full-access-shared-document-with-add-action');
    const createFromSidebar = async (parentId: string, title: string) => {
      const targetRow = page.getByTestId(`page-${parentId}`);

      await targetRow.hover();
      await expect(targetRow.getByTestId('inline-add-page')).toBeVisible();
      await targetRow.getByTestId('inline-add-page').click();
      await expect(page.getByTestId('add-document-button')).toBeVisible();
      const created = page.waitForResponse(async (response) => {
        if (
          response.request().method() !== 'POST' ||
          !response.url().endsWith('/v2/page-view/document/default') ||
          response.request().postDataJSON().parent_view_id !== parentId
        )
          return false;
        // The current client can retry RetryLater; wait for its committed receipt.
        return response.ok() && (await response.json()).code === 0;
      });

      await page.getByTestId('add-document-button').click();
      const createResponse = await created;
      const createCommand = createResponse.request().postDataJSON();
      const receipt = await successful<{ request_id: string; result: { view_id: string } }>(
        createResponse,
        'Create subpage through the Shared with me menu'
      );
      const viewId = receipt.result.view_id;

      expect(receipt.request_id).toBe(createCommand.request_id);
      expect(viewId).toBe(createCommand.view_id);
      expect(createCommand.parent_view_id).toBe(parentId);
      const viewModal = page.getByRole('dialog').filter({ has: page.getByTestId('view-modal-close') });
      const titleInput = viewModal.locator(`[id="editor-title-${viewId}"]`);

      await expect(viewModal.locator(`[id="editor-${viewId}"]`)).toBeVisible({ timeout: 30_000 });
      await expect(titleInput).toBeVisible();
      const renamed = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith(`/page-view/${viewId}/update-name`) &&
          response.request().postDataJSON().name === title
      );

      await titleInput.fill(title);
      await titleInput.press('Enter');
      await successful(await renamed, 'Persist member-created subpage title');
      await expect(titleInput).toHaveText(title);
      await viewModal.getByTestId('view-modal-close').click();
      await expect(page.getByTestId(`page-${viewId}`).getByTestId('page-name')).toHaveText(title);
      return { viewId, createCommand, receipt };
    };
    const createdTitle = `C12 member subpage ${runId.slice(0, 8)}`;
    const created = await createFromSidebar(parent.view_id, createdTitle);
    const createdViewId = created.viewId;
    const createdRow = page.getByTestId(`page-${createdViewId}`);

    expect(createdViewId).not.toBe(child.view_id);
    await createdRow.getByTestId('page-name').click();
    await expect(page).toHaveURL(new RegExp(`/app/${workspaceId}/${createdViewId}`));
    await expect(page.locator(`[id="editor-title-${createdViewId}"]`)).toHaveText(createdTitle);
    await page.reload();
    await expect(page.locator(`[id="editor-${createdViewId}"]`)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`[id="editor-title-${createdViewId}"]`)).toHaveText(createdTitle);
    await expect(page.getByTestId(`space-${privateSpace.view_id}`)).toHaveCount(0);
    await expect(page.getByTestId(`page-${sibling.view_id}`)).toHaveCount(0);
    // Shared tree expansion is local UI state and resets on a full reload.
    await expandSidebarRow(parent.view_id);

    // A shared descendant must use its own ID as the parent, not the virtual
    // Shared-with-me root or the top-level explicitly shared document.
    const grandchildTitle = `C12 nested member subpage ${runId.slice(0, 8)}`;
    const grandchild = await createFromSidebar(createdViewId, grandchildTitle);
    const grandchildRow = page.getByTestId(`page-${grandchild.viewId}`);

    expect(grandchild.viewId).not.toBe(createdViewId);
    await grandchildRow.getByTestId('page-name').click();
    await expect(page).toHaveURL(new RegExp(`/app/${workspaceId}/${grandchild.viewId}`));
    await page.reload();
    await expect(page.locator(`[id="editor-${grandchild.viewId}"]`)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`[id="editor-title-${grandchild.viewId}"]`)).toHaveText(grandchildTitle);
    await expandSidebarRow(parent.view_id);
    await expandSidebarRow(createdViewId);
    await expect(createdRow.getByTestId('page-name')).toHaveText(createdTitle);
    await expect(grandchildRow.getByTestId('page-name')).toHaveText(grandchildTitle);

    const persistedParent = await successful<ViewNode>(
      await request.get(`${workspaceUrl}/view/${parent.view_id}?depth=3`, { headers: ownerHeaders }),
      'Read canonical parent after browser creation and reload'
    );
    const persistedSharedTree = await successful<ViewNode>(
      await request.get(`${TestConfig.apiUrl}/api/sharing/workspace/${workspaceId}/view/${workspaceId}?depth=50`, {
        headers: memberHeaders,
      }),
      'Read persisted Shared with me projection'
    );

    expect(persistedParent.parent_view_id).toBe(privateSpace.view_id);
    expect(findView(persistedParent, createdViewId)).toMatchObject({
      parent_view_id: parent.view_id,
      name: createdTitle,
    });
    expect(findView(persistedSharedTree, parent.view_id)?.parent_view_id).toBe(workspaceId);
    expect(findView(persistedSharedTree, createdViewId)).toMatchObject({
      parent_view_id: parent.view_id,
      name: createdTitle,
    });
    for (const tree of [persistedParent, persistedSharedTree]) {
      expect(findView(tree, grandchild.viewId)).toMatchObject({
        parent_view_id: createdViewId,
        name: grandchildTitle,
      });
    }
    expect(findView(persistedSharedTree, privateSpace.view_id)).toBeUndefined();
    expect(findView(persistedSharedTree, sibling.view_id)).toBeUndefined();
    for (const viewId of [privateSpace.view_id, sibling.view_id]) {
      const response = await request.get(`${workspaceUrl}/view/${viewId}`, { headers: memberHeaders });

      expect((await response.json()).code, 'Browser child creation must preserve private-space isolation').toBe(1012);
    }

    await saveScreenshot('member-created-child-and-grandchild-after-reload');
    await testInfo.attach('browser-creation-and-canonical-parent', {
      body: JSON.stringify({ created, grandchild, persistedParent, persistedSharedTree }, null, 2),
      contentType: 'application/json',
    });
  });
}
