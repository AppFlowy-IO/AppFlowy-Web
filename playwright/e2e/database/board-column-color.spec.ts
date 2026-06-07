import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import {
  BoardSelectors,
  DatabaseGridSelectors,
  DatabaseViewSelectors,
  GridFieldSelectors,
  PropertyMenuSelectors,
  SingleSelectSelectors,
} from '../../support/selectors';
import { signInAndCreateDatabaseView } from '../../support/database-ui-helpers';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';
import { waitForDatabaseDocReady } from '../../support/yjs-inject-helpers';

type SelectOptionColor = 'Blue' | 'Lime';

interface SelectOptionInfo {
  fieldId: string;
  optionId: string;
  color: string;
}

const colorTargets: Record<SelectOptionColor, { fillVar: string }> = {
  Blue: {
    fillVar: '--tag-fill-09-light',
  },
  Lime: {
    fillVar: '--tag-fill-06-light',
  },
};

test.describe('Board column color', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('updates the board group color when the backing select option color changes', async ({ page, request }) => {
    const testEmail = generateRandomEmail();

    await createBoardAndWait(page, request, testEmail);
    await waitForDatabaseDocReady(page);

    await enableBoardColorColumnsViaYjs(page);

    const todoOption = await findSelectOptionByNameViaYjs(page, 'To Do');
    const targetColor: SelectOptionColor = todoOption.color === 'Blue' ? 'Lime' : 'Blue';

    await updateSelectOptionColorViaYjs(page, todoOption.optionId, targetColor);

    await expect
      .poll(() => findSelectOptionByIdViaYjs(page, todoOption.optionId).then((option) => option.color))
      .toBe(targetColor);

    const column = BoardSelectors.boardContainer(page).locator(`[data-column-id="${todoOption.optionId}"]`);
    const columnSurface = getColumnSurface(column);
    const expectedBackgroundColor = await resolveCssColor(page, colorTargets[targetColor].fillVar);

    await expect(column).toBeVisible({ timeout: 15000 });
    await expect.poll(() => getComputedBackgroundColor(columnSurface)).toBe(expectedBackgroundColor);
  });

  test('updates the board group color after editing the shared option color from a grid view', async ({
    page,
    request,
  }) => {
    const testEmail = generateRandomEmail();

    await createBoardAndWait(page, request, testEmail);
    await waitForDatabaseDocReady(page);
    await enableBoardColorColumnsViaYjs(page);

    const todoOption = await findSelectOptionByNameViaYjs(page, 'To Do');
    const targetColor: SelectOptionColor = todoOption.color === 'Blue' ? 'Lime' : 'Blue';
    const target = colorTargets[targetColor];

    await addDatabaseViewFromTabBar(page, 'Grid');
    await expect(DatabaseGridSelectors.grid(page)).toBeVisible({ timeout: 15000 });

    await openGridSelectOptionEditor(page, todoOption);
    await selectOptionMenuColor(page, target.fillVar);

    await expect
      .poll(() => findSelectOptionByIdViaYjs(page, todoOption.optionId).then((option) => option.color))
      .toBe(targetColor);

    await closeOpenMenus(page);
    await switchDatabaseViewByName(page, 'Board');

    const column = BoardSelectors.boardContainer(page).locator(`[data-column-id="${todoOption.optionId}"]`);
    const columnSurface = getColumnSurface(column);
    const expectedBackgroundColor = await resolveCssColor(page, target.fillVar);

    await expect(column).toBeVisible({ timeout: 15000 });
    await expect.poll(() => getComputedBackgroundColor(columnSurface)).toBe(expectedBackgroundColor);
  });
});

async function createBoardAndWait(page: Page, request: APIRequestContext, testEmail: string) {
  await signInAndCreateDatabaseView(page, request, testEmail, 'Board', {
    verify: async (p) => {
      await expect(BoardSelectors.boardContainer(p)).toBeVisible({ timeout: 15000 });
      await expect(BoardSelectors.boardContainer(p).locator('[data-column-id]').first()).toBeVisible({
        timeout: 15000,
      });
      await expect(BoardSelectors.boardContainer(p).getByText('To Do')).toBeVisible({ timeout: 15000 });
    },
  });
}

async function enableBoardColorColumnsViaYjs(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as any;
    const doc = win.__TEST_DATABASE_DOC__;
    const Y = win.Y;
    const sharedRoot = doc.getMap('data');
    const database = sharedRoot.get('database');
    const view = database.get('views').get(win.__TEST_DATABASE_VIEW_ID__);

    doc.transact(() => {
      let layoutSettings = view.get('layout_settings');

      if (!layoutSettings) {
        layoutSettings = new Y.Map();
        view.set('layout_settings', layoutSettings);
      }

      let boardLayoutSettings = layoutSettings.get('1');

      if (!boardLayoutSettings) {
        boardLayoutSettings = new Y.Map();
        layoutSettings.set('1', boardLayoutSettings);
      }

      boardLayoutSettings.set('show_color_columns', true);
    }, 'remote');
  });
}

async function findSelectOptionByNameViaYjs(page: Page, optionName: string): Promise<SelectOptionInfo> {
  const option = await page.evaluate((name) => {
    const win = window as any;
    const doc = win.__TEST_DATABASE_DOC__;
    const sharedRoot = doc.getMap('data');
    const database = sharedRoot.get('database');
    const fields = database.get('fields');
    let result: SelectOptionInfo | undefined;

    fields.forEach((field: any, fieldId: string) => {
      if (result) return;

      const fieldType = String(field.get('ty'));
      const typeOption = field.get('type_option')?.get(fieldType);
      const content = typeOption?.get('content');

      if (!content) return;

      const parsed = JSON.parse(content) as { options?: Array<{ id: string; name: string; color: string }> };
      const selectOption = parsed.options?.find((option) => option.name === name);

      if (!selectOption) return;

      result = {
        fieldId,
        optionId: selectOption.id,
        color: selectOption.color,
      };
    });

    return result;
  }, optionName);

  if (!option) {
    throw new Error(`Select option "${optionName}" was not found`);
  }

  return option;
}

async function findSelectOptionByIdViaYjs(page: Page, optionId: string): Promise<SelectOptionInfo> {
  const option = await page.evaluate((id) => {
    const win = window as any;
    const doc = win.__TEST_DATABASE_DOC__;
    const sharedRoot = doc.getMap('data');
    const database = sharedRoot.get('database');
    const fields = database.get('fields');
    let result: SelectOptionInfo | undefined;

    fields.forEach((field: any, fieldId: string) => {
      if (result) return;

      const fieldType = String(field.get('ty'));
      const typeOption = field.get('type_option')?.get(fieldType);
      const content = typeOption?.get('content');

      if (!content) return;

      const parsed = JSON.parse(content) as { options?: Array<{ id: string; color: string }> };
      const selectOption = parsed.options?.find((option) => option.id === id);

      if (!selectOption) return;

      result = {
        fieldId,
        optionId: selectOption.id,
        color: selectOption.color,
      };
    });

    return result;
  }, optionId);

  if (!option) {
    throw new Error(`Select option "${optionId}" was not found`);
  }

  return option;
}

async function updateSelectOptionColorViaYjs(page: Page, optionId: string, color: SelectOptionColor): Promise<void> {
  await page.evaluate(
    ({ optionId, color }) => {
      const win = window as any;
      const doc = win.__TEST_DATABASE_DOC__;
      const sharedRoot = doc.getMap('data');
      const database = sharedRoot.get('database');
      const fields = database.get('fields');
      let updated = false;

      fields.forEach((field: any) => {
        if (updated) return;

        const fieldType = String(field.get('ty'));
        const typeOption = field.get('type_option')?.get(fieldType);
        const content = typeOption?.get('content');

        if (!content) return;

        const parsed = JSON.parse(content) as { options?: Array<{ id: string; color: string }> };
        const options = parsed.options ?? [];

        if (!options.some((option) => option.id === optionId)) return;

        doc.transact(() => {
          typeOption.set(
            'content',
            JSON.stringify({
              ...parsed,
              options: options.map((option) => (option.id === optionId ? { ...option, color } : option)),
            })
          );
        }, 'remote');

        updated = true;
      });

      if (!updated) {
        throw new Error(`Select option "${optionId}" was not found`);
      }
    },
    { optionId, color }
  );
}

async function addDatabaseViewFromTabBar(page: Page, viewType: 'Grid' | 'Board' | 'Calendar' | 'Chart'): Promise<void> {
  await DatabaseViewSelectors.addViewButton(page).click({ force: true });

  const menu = page.locator('[data-slot="dropdown-menu-content"]').last();

  await expect(menu).toBeVisible({ timeout: 5000 });
  await menu.getByRole('menuitem', { name: new RegExp(`^${viewType}$`, 'i') }).click({ force: true });
}

async function openGridSelectOptionEditor(page: Page, option: SelectOptionInfo): Promise<void> {
  await GridFieldSelectors.fieldHeader(page, option.fieldId).last().click({ force: true });
  await expect(PropertyMenuSelectors.editPropertyMenuItem(page).first()).toBeVisible({ timeout: 10000 });
  await PropertyMenuSelectors.editPropertyMenuItem(page).first().click({ force: true });
  await expect(SingleSelectSelectors.selectOption(page, option.optionId)).toBeVisible({ timeout: 10000 });
  await SingleSelectSelectors.selectOption(page, option.optionId).click({ force: true });
}

async function selectOptionMenuColor(page: Page, fillVar: string): Promise<void> {
  const menu = page.locator('[data-slot="dropdown-menu-content"]').last();
  const colorTile = menu.locator(`div[style*="${fillVar}"]`).first();

  await expect(colorTile).toBeVisible({ timeout: 5000 });
  await colorTile.click({ force: true });
}

async function closeOpenMenus(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

async function switchDatabaseViewByName(page: Page, viewName: string): Promise<void> {
  await DatabaseViewSelectors.viewTab(page).filter({ hasText: viewName }).first().click({ force: true });
  await expect(BoardSelectors.boardContainer(page)).toBeVisible({ timeout: 15000 });
}

function getColumnSurface(column: Locator): Locator {
  return column.locator(':scope > div').first();
}

async function getComputedBackgroundColor(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).backgroundColor);
}

async function resolveCssColor(page: Page, cssVariable: string): Promise<string> {
  return page.evaluate((variable) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
    const probe = document.createElement('div');

    probe.style.backgroundColor = value;
    document.body.appendChild(probe);

    const computedColor = getComputedStyle(probe).backgroundColor;

    probe.remove();

    return computedColor;
  }, cssVariable);
}
