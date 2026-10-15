import { test, expect, type Page } from '@playwright/test';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { PageSelectors, ModalSelectors, SidebarSelectors, ViewActionSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';

async function expandCreatedParent(page: Page, parentId: string) {
  const space = page.getByTestId(`space-${parentId}`);

  await expect(space).toBeVisible();
  if (await space.getAttribute('data-expanded') !== 'true') await space.getByTestId('space-name').click();
  await expect(space).toHaveAttribute('data-expanded', 'true');
}

test('creates, renames, reopens and deletes the exact atomic Document across reloads', async ({ page, request }) => {
  const title = `Atomic Document ${Date.now()}`;

  await signInAndWaitForApp(page, request, generateRandomEmail(), 0);
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible();
  await PageSelectors.newPageButton(page).click();
  const newPageModal = ModalSelectors.newPageModal(page);

  await expect(newPageModal).toBeVisible();
  await newPageModal.getByTestId('space-item').first().click();
  const created = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/v2/page-view/document/default'));

  await newPageModal.getByRole('button', { name: 'Add', exact: true }).click();
  const response = await created;
  const receipt = await response.json();
  const command = response.request().postDataJSON();
  const documentId = command.view_id as string;
  const parentId = command.parent_view_id as string;

  expect(receipt.code).toBe(0);
  expect(receipt.data.result.view_id).toBe(documentId);
  const viewModal = page.getByRole('dialog').filter({ has: page.getByTestId('view-modal-close') });
  const titleInput = viewModal.locator(`[id="editor-title-${documentId}"]`);

  await expect(viewModal.locator(`[id="editor-${documentId}"]`)).toBeVisible();
  await expect(titleInput).toBeVisible();
  const renamed = page.waitForResponse((result) => result.request().method() === 'POST' &&
    new URL(result.url()).pathname.endsWith(`/page-view/${documentId}/update-name`) && result.request().postDataJSON().name === title);

  await titleInput.fill(title);
  await titleInput.press('Enter');
  expect((await (await renamed).json()).code).toBe(0);
  await expect(titleInput).toHaveText(title);
  await viewModal.getByTestId('view-modal-close').click();
  await expandCreatedParent(page, parentId);
  const sidebarPage = PageSelectors.pageByViewId(page, documentId);

  await expect(sidebarPage.getByTestId('page-name')).toHaveText(title);
  await sidebarPage.getByTestId('page-name').click();
  await expect(page).toHaveURL(new RegExp(documentId));
  await expect(sidebarPage).toHaveAttribute('data-selected', 'true');
  await expect(page.locator(`[id="editor-title-${documentId}"]`)).toHaveText(title);
  await expect(page.locator(`[id="editor-${documentId}"]`)).toBeVisible();

  await page.reload();
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible();
  await expandCreatedParent(page, parentId);
  await expect(sidebarPage.getByTestId('page-name')).toHaveText(title);
  await expect(sidebarPage).toHaveAttribute('data-selected', 'true');
  await expect(page.locator(`[id="editor-title-${documentId}"]`)).toHaveText(title);
  await expect(page.locator(`[id="editor-${documentId}"]`)).toBeVisible();

  const exactItem = PageSelectors.itemByViewId(page, documentId);

  await exactItem.hover();
  await exactItem.getByTestId('page-more-actions').click();
  await expect(ViewActionSelectors.popover(page)).toBeVisible();
  const deleted = page.waitForResponse((result) => result.request().method() === 'POST' &&
    new URL(result.url()).pathname.endsWith(`/page-view/${documentId}/move-to-trash`));

  await ViewActionSelectors.deleteButton(page).click();
  expect((await (await deleted).json()).code).toBe(0);
  await expect(sidebarPage).toHaveCount(0);
  await page.reload();
  await expect(SidebarSelectors.pageHeader(page)).toBeVisible();
  await expandCreatedParent(page, parentId);
  await expect(sidebarPage).toHaveCount(0);
  await expect(PageSelectors.names(page).filter({ hasText: title })).toHaveCount(0);
});
