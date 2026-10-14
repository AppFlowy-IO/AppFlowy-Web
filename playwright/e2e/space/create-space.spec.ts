import { test, expect, type Page } from '@playwright/test';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { PageSelectors, SpaceSelectors, SidebarSelectors, ModalSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

const documentRoute = '**/v2/page-view/document/default';

async function openSpaceDraft(page: Page, spaceName: string) {
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible();
  await PageSelectors.newPageButton(page).click();
  await expect(ModalSelectors.newPageModal(page)).toBeVisible();
  await ModalSelectors.createNewSpaceButton(page).click();
  const modal = SpaceSelectors.createSpaceModal(page);

  await expect(modal).toBeVisible();
  await expect(SpaceSelectors.manageSpaceModal(page)).toHaveCount(0);
  await expect(modal.getByTestId('space-settings-panel')).toBeVisible();
  await expect(modal.getByTestId('manage-space-public-access-card')).toBeVisible();
  await expect(modal.getByTestId('create-space-submit')).toBeDisabled();
  await expect(SpaceSelectors.spaceNameInput(page)).toHaveValue('');
  await SpaceSelectors.spaceNameInput(page).fill(spaceName);
  await expect(SpaceSelectors.itemByName(page, spaceName)).toHaveCount(0);
  await expect(modal.getByTestId('create-space-submit')).toBeEnabled();
  return modal;
}

async function verifyInitialDocument(page: Page, spaceId: string, documentId: string, spaceName: string) {
  await expect(SpaceSelectors.createSpaceModal(page)).toBeHidden();
  const space = page.getByTestId(`space-${spaceId}`);
  const viewModal = page.getByRole('dialog').filter({ has: page.getByTestId('view-modal-close') });

  await expect(space.getByTestId('space-name')).toHaveText(spaceName);
  await expect(viewModal.locator(`[id="editor-title-${documentId}"]`)).toBeVisible();
  await expect(viewModal.locator(`[id="editor-${documentId}"]`)).toBeVisible();
  await viewModal.getByTestId('view-modal-close').click();
  if (await space.getAttribute('data-expanded') !== 'true') await space.getByTestId('space-name').click();
  await expect(space).toHaveAttribute('data-expanded', 'true');
  const child = PageSelectors.pageByViewId(page, documentId);

  await expect(child).toBeVisible();
  await child.getByTestId('page-name').click();
  await expect(page).toHaveURL(new RegExp(documentId));
  await expect(child).toHaveAttribute('data-selected', 'true');
  await expect(page.locator(`[id="editor-${documentId}"]`)).toBeVisible();
  await expect(page.locator(`[id="editor-title-${documentId}"]`)).toBeVisible();
}

test.describe('Space Creation Tests', () => {
  test('creates a space whose exact initial Document is readable in the modal and sidebar', async ({ page, request }) => {
    const spaceName = `Test Space ${Date.now()}`;

    await signInAndWaitForApp(page, request, generateRandomEmail(), 0);
    const modal = await openSpaceDraft(page, spaceName);
    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().endsWith('/v2/page-view/document/default'));

    await modal.getByTestId('create-space-submit').click();
    const response = await created;
    const receipt = await response.json();
    const command = response.request().postDataJSON();

    expect(receipt.code).toBe(0);
    expect(receipt.data.result.view_id).toBe(command.view_id);
    expect(command).not.toHaveProperty('page_data');
    await verifyInitialDocument(page, command.parent_view_id, command.view_id, spaceName);

    // Reload the exact route instead of accepting any Untitled page from the sidebar.
    await page.reload();
    await expect(SidebarSelectors.pageHeader(page)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(command.view_id));
    await expect(page.locator(`[id="editor-${command.view_id}"]`)).toBeVisible();
    await expect(PageSelectors.pageByViewId(page, command.view_id)).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId(`space-${command.parent_view_id}`).getByTestId('space-name')).toHaveText(spaceName);
  });

  test('retries a lost initial-Document acknowledgement through Create Space using the exact saved command', async ({ page, request }) => {
    const spaceName = `Retry Space ${Date.now()}`;
    const documentRequests: string[] = [];
    const cleanupRequests: string[] = [];
    let committedDocumentId = '';
    let parentId = '';

    await signInAndWaitForApp(page, request, generateRandomEmail(), 0);
    page.on('request', (sent) => {
      if (sent.method() === 'POST' && sent.url().endsWith('/v2/page-view/document/default')) documentRequests.push(sent.postData() ?? '');
      if (sent.url().includes('/move-to-trash') || sent.method() === 'DELETE' && sent.url().includes('/trash/')) cleanupRequests.push(sent.url());
    });
    await page.route(documentRoute, async (route) => {
      const command = route.request().postDataJSON();
      const response = await route.fetch();
      const receipt = await response.json();

      expect(receipt.code).toBe(0);
      committedDocumentId = receipt.data.result.view_id;
      parentId = command.parent_view_id;
      await route.abort('failed');
    }, { times: 1 });
    const modal = await openSpaceDraft(page, spaceName);

    await modal.getByTestId('create-space-submit').click();
    await expect(modal.getByTestId('create-space-submit')).toHaveText('Retry');
    await expect(modal.getByTestId('create-space-submit')).toBeEnabled();
    await expect(modal).toBeVisible();
    await expect(page.locator(`[id="editor-${committedDocumentId}"]`)).toHaveCount(0);
    expect(documentRequests).toHaveLength(1);
    expect(cleanupRequests.filter((url) => url.includes(parentId))).toEqual([]);

    const retried = page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().endsWith('/v2/page-view/document/default'));

    await modal.getByTestId('create-space-submit').click();
    const receipt = await (await retried).json();

    expect(receipt.code).toBe(0);
    expect(receipt.data.result.view_id).toBe(committedDocumentId);
    expect(receipt.data.outcome).toBe('already_applied');
    expect(documentRequests).toHaveLength(2);
    expect(documentRequests[1]).toBe(documentRequests[0]);
    expect(cleanupRequests.filter((url) => url.includes(parentId))).toEqual([]);
    await verifyInitialDocument(page, parentId, committedDocumentId, spaceName);
  });
});
