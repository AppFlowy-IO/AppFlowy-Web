import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createChildDocumentUnder, createNamedDocumentPage } from '../../support/duplicate-test-helpers';
import {
  finishOutlineDrag,
  readDropIndicatorGeometry,
  readDropIndicatorTargetName,
  readSidebarPageNames,
  startOutlineDragInto,
  startOutlineDragOver,
} from '../../support/outline-drag-helpers';
import { expandPageByName } from '../../support/page/flows';
import { itemDirectChildPageItems, PageSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

const { Given, Then, When } = createBdd();

/** Half the 2px indicator, so "is it below X" tolerates sub-pixel layout. */
const EDGE_TOLERANCE_PX = 2;

Given('the sidebar drag user is signed in', async ({ page, request }) => {
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAndWaitForApp(page, request, generateRandomEmail());
});

Given('a page {string} in the sidebar', async ({ page }, pageName: string) => {
  await createNamedDocumentPage(page, pageName);
  await expect(PageSelectors.itemByName(page, pageName)).toBeVisible({ timeout: 20_000 });
});

Given(
  'a page {string} in the sidebar with the child {string}',
  async ({ page }, pageName: string, childName: string) => {
    await createNamedDocumentPage(page, pageName);
    await createChildDocumentUnder(page, pageName, childName);
    // The parent may be collapsed right after creation; the row only has to
    // exist here, the "is expanded" step brings it on screen.
    await expect(PageSelectors.itemByName(page, childName)).toBeAttached({ timeout: 20_000 });
  }
);

Given('{string} is expanded', async ({ page }, pageName: string) => {
  await expandPageByName(page, pageName);
  // The child rows have to be laid out before the indicator can be measured
  // against them.
  await expect
    .poll(() => PageSelectors.itemByName(page, pageName).getByTestId('page-name').count(), {
      timeout: 20_000,
      message: `Waiting for "${pageName}" to render its children`,
    })
    .toBeGreaterThan(1);
});

When(
  '{string} is dragged over the bottom of {string} without dropping',
  async ({ page }, sourceName: string, targetName: string) => {
    await startOutlineDragOver(page, sourceName, targetName, 'bottom');
  }
);

When(
  '{string} is dragged into the center of {string} without dropping',
  async ({ page }, sourceName: string, targetName: string) => {
    await startOutlineDragInto(page, sourceName, targetName);
  }
);

Then('{string} is the active child drop target', async ({ page }, targetName: string) => {
  const targetRow = PageSelectors.itemByName(page, targetName).locator(':scope > [data-testid^="page-"]').first();

  await expect(targetRow).toHaveAttribute('data-drop-instruction', 'make-child');
});

Then('the drop indicator is attached to {string}', async ({ page }, targetName: string) => {
  expect(await readDropIndicatorTargetName(page)).toBe(targetName);
});

Then('the drop indicator sits below the expanded children of {string}', async ({ page }, targetName: string) => {
  const geometry = await readDropIndicatorGeometry(page);

  expect(geometry.edge, `expected a bottom-edge indicator on "${targetName}"`).toBe('bottom');
  expect(
    geometry.lastDescendantBottom,
    `"${targetName}" should have a rendered child for this assertion to mean anything`
  ).not.toBeNull();
  // Dropping here lands the page after the whole subtree, so the line has to be
  // below the last child's row — not tucked between the parent and that child.
  expect(geometry.indicatorBottom).toBeGreaterThanOrEqual((geometry.lastDescendantBottom as number) - EDGE_TOLERANCE_PX);
  expect(geometry.indicatorBottom).toBeGreaterThanOrEqual(geometry.subtreeBottom - EDGE_TOLERANCE_PX);
});

Then('the drop indicator does not sit at the bottom of the {string} name row', async ({ page }, targetName: string) => {
  const geometry = await readDropIndicatorGeometry(page);

  expect(geometry.indicatorBottom, `the indicator is still pinned to the "${targetName}" name row`).toBeGreaterThan(
    geometry.rowBottom + EDGE_TOLERANCE_PX
  );
});

Then('the drop indicator sits at the bottom of the {string} name row', async ({ page }, targetName: string) => {
  const geometry = await readDropIndicatorGeometry(page);

  expect(geometry.edge, `expected a bottom-edge indicator on "${targetName}"`).toBe('bottom');
  // No children rendered, so the row and the wrapper end at the same place.
  expect(geometry.lastDescendantBottom).toBeNull();
  expect(Math.abs(geometry.indicatorBottom - geometry.rowBottom)).toBeLessThanOrEqual(EDGE_TOLERANCE_PX);
});

When('the drag is released', async ({ page }) => {
  await finishOutlineDrag(page);
});

Then('the sidebar lists {string} in that order', async ({ page }, expected: string) => {
  const names = expected
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  await expect
    .poll(() => readSidebarPageNames(page, names), {
      timeout: 30_000,
      message: `Waiting for the sidebar order ${expected}`,
    })
    .toEqual(names);
});

Then('{string} is a direct child of {string}', async ({ page }, childName: string, parentName: string) => {
  const directChildNames = PageSelectors.itemByName(page, parentName).locator(
    `${itemDirectChildPageItems()} > [data-testid^="page-"] [data-testid="page-name"]`
  );

  await expect
    .poll(() => directChildNames.allTextContents(), {
      timeout: 30000,
      message: `Waiting for "${childName}" to become a direct child of "${parentName}"`,
    })
    .toContain(childName);
});

When('the sidebar drag app is reloaded', async ({ page }) => {
  await page.reload({ waitUntil: 'domcontentloaded' });
});
