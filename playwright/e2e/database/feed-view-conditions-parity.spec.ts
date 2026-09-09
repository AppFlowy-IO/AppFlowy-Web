import { expect, Page, test } from '@playwright/test';

import { FieldType, SortCondition } from '../../../src/application/database-yjs/database.type';
import { seedFeedConditions } from '../../support/feed-fixture-helpers';
import { addFeedView, expectFeedTitles, openFeedCard, switchToFeedOrGridView } from '../../support/feed-test-helpers';
import {
  addFilterByFieldName,
  changeCheckboxFilterCondition,
  changeFilterCondition,
  changeSelectFilterCondition,
  CheckboxFilterCondition,
  enterFilterText,
  generateRandomEmail,
  loginAndCreateGrid,
  NumberFilterCondition,
  SelectFilterCondition,
  selectFilterOption,
  setupPageErrorHandling,
  TextFilterCondition,
} from '../../support/filter-test-helpers';
import { setCellDirect, setFiltersDirect, setSortsDirect } from '../../support/gallery-test-helpers';
import { renameOpenRowDetailTitle, setPrimaryCellTextDirect } from '../../support/relation-test-helpers';
import { closeRowDetailWithEscape } from '../../support/row-detail-helpers';
import { DatabaseFeedSelectors, DatabaseGridSelectors, RowDetailSelectors } from '../../support/selectors';
import {
  addSortByFieldName,
  changeSortDirection,
  closeSortMenu,
  openSortMenu,
  SortDirection,
} from '../../support/sort-test-helpers';

type Fixture = Awaited<ReturnType<typeof seedFeedConditions>> & { feedViewId: string };
const testWithFeed = test.extend<{ feed: Fixture }>({
  feed: async ({ page, request }, use) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ height: 1000, width: 1440 });
    await loginAndCreateGrid(page, request, generateRandomEmail());
    const data = await seedFeedConditions(page);
    const feedViewId = await addFeedView(page);

    await expectFeedTitles(page, ['Cherry', 'Apple', 'Banana']);
    await use({ ...data, feedViewId });
  },
});

async function textFilter(page: Page, fieldId: string, condition: TextFilterCondition, content = '') {
  await setFiltersDirect(page, [{ fieldId, fieldType: FieldType.RichText, condition, content }]);
}

async function createTitledRow(page: Page, title: string) {
  await DatabaseFeedSelectors.newRowButton(page).scrollIntoViewIfNeeded();
  await DatabaseFeedSelectors.newRowButton(page).click();
  await expect(RowDetailSelectors.modal(page)).toBeVisible({ timeout: 20_000 });
  await renameOpenRowDetailTitle(page, title);
  await closeRowDetailWithEscape(page);
}

testWithFeed.describe('Desktop Feed filter cases', () => {
  testWithFeed('create text filter in feed view excludes empty names', async ({ page, feed }) => {
    await setPrimaryCellTextDirect(page, feed.rowIds[2], '');
    await addFilterByFieldName(page, 'Name');
    await changeFilterCondition(page, TextFilterCondition.TextIsNotEmpty);
    await expectFeedTitles(page, ['Apple', 'Banana']);
    await changeFilterCondition(page, TextFilterCondition.TextIsEmpty);
    await page.keyboard.press('Escape');
    await expectFeedTitles(page, ['Untitled']);
  });

  for (const [label, condition, expected] of [
    ['create checkbox filter in feed view', CheckboxFilterCondition.IsChecked, ['Cherry', 'Banana']],
    ['checkbox filter - unchecked condition', CheckboxFilterCondition.IsUnchecked, ['Apple']],
  ] as const) {
    testWithFeed(label, async ({ page, feed }) => {
      expect(feed.fields.done).toBeTruthy();
      await addFilterByFieldName(page, 'Completed');
      await changeCheckboxFilterCondition(page, condition);
      await expectFeedTitles(page, [...expected]);
    });
  }

  for (const [label, condition, expected] of [
    ['create select option filter in feed view', SelectFilterCondition.OptionIs, ['Banana']],
    ['select option filter - OptionIsNot condition', SelectFilterCondition.OptionIsNot, ['Cherry', 'Apple']],
    ['select option filter - OptionIsEmpty condition', SelectFilterCondition.OptionIsEmpty, ['Apple']],
    ['select option filter - OptionIsNotEmpty condition', SelectFilterCondition.OptionIsNotEmpty, ['Cherry', 'Banana']],
  ] as const) {
    testWithFeed(label, async ({ page, feed }) => {
      expect(feed.fields.status).toBeTruthy();
      await addFilterByFieldName(page, 'Choice');
      await changeSelectFilterCondition(page, condition);
      if (condition === SelectFilterCondition.OptionIs || condition === SelectFilterCondition.OptionIsNot) {
        await selectFilterOption(page, 'Red');
      }

      await page.keyboard.press('Escape');
      await expectFeedTitles(page, [...expected]);
    });
  }

  testWithFeed('change filter condition updates feed', async ({ page, feed }) => {
    await textFilter(page, feed.fields.name, TextFilterCondition.TextContains, 'a');
    await expectFeedTitles(page, ['Apple', 'Banana']);
    await page.getByTestId('database-filter-condition').first().click();
    await changeFilterCondition(page, TextFilterCondition.TextDoesNotContain);
    await page.keyboard.press('Escape');
    await expectFeedTitles(page, ['Cherry']);
  });

  testWithFeed('new row matching filter appears in feed', async ({ page, feed }) => {
    await textFilter(page, feed.fields.name, TextFilterCondition.TextStartsWith, 'App');
    await expectFeedTitles(page, ['Apple']);
    await createTitledRow(page, 'Application');
    await expectFeedTitles(page, ['Application', 'Apple']);
  });

  testWithFeed('edit row to match filter makes it appear', async ({ page, feed }) => {
    await textFilter(page, feed.fields.name, TextFilterCondition.TextStartsWith, 'App');
    await expectFeedTitles(page, ['Apple']);
    await setPrimaryCellTextDirect(page, feed.rowIds[0], 'Appetizer');
    await expectFeedTitles(page, ['Apple', 'Appetizer']);
  });

  testWithFeed('edit row to not match filter hides it', async ({ page, feed }) => {
    await textFilter(page, feed.fields.name, TextFilterCondition.TextStartsWith, 'App');
    await openFeedCard(page, feed.rowIds[1]);
    await renameOpenRowDetailTitle(page, 'Pear');
    await closeRowDetailWithEscape(page);
    await expectFeedTitles(page, []);
    await expect(page.getByTestId('database-new-row-button')).toBeVisible();
  });

  testWithFeed(
    'filter persists when switching to grid and back; filter is isolated per view',
    async ({ page, feed }) => {
      await textFilter(page, feed.fields.name, TextFilterCondition.TextStartsWith, 'App');
      await expectFeedTitles(page, ['Apple']);
      await switchToFeedOrGridView(page, feed.gridViewId, 'Grid');
      await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
      await switchToFeedOrGridView(page, feed.feedViewId, 'Feed');
      await expectFeedTitles(page, ['Apple']);
      const secondFeedId = await addFeedView(page);

      await setFiltersDirect(page, []);
      await expectFeedTitles(page, ['Cherry', 'Apple', 'Banana']);
      await switchToFeedOrGridView(page, feed.feedViewId, 'Feed');
      await expectFeedTitles(page, ['Apple']);
      expect(secondFeedId).not.toBe(feed.feedViewId);
    }
  );
});

testWithFeed.describe('Desktop Feed sort cases', () => {
  testWithFeed('create ascending and descending sorts in feed view keep empty names last', async ({ page, feed }) => {
    await setPrimaryCellTextDirect(page, feed.rowIds[2], '');
    await addSortByFieldName(page, 'Name');
    await expectFeedTitles(page, ['Apple', 'Banana', 'Untitled']);
    await openSortMenu(page);
    await changeSortDirection(page, 0, SortDirection.Descending);
    await closeSortMenu(page);
    await expectFeedTitles(page, ['Banana', 'Apple', 'Untitled']);
  });

  for (const [field, expected] of [
    ['Score', ['Apple', 'Banana', 'Cherry']],
    ['Completed', ['Apple', 'Banana', 'Cherry']],
    ['Choice', ['Cherry', 'Banana', 'Apple']],
    ['Date', ['Apple', 'Banana', 'Cherry']],
  ] as const) {
    testWithFeed(`sort by ${field} field in feed view`, async ({ page, feed }) => {
      expect(feed.feedViewId).toBeTruthy();
      await addSortByFieldName(page, field);
      await expectFeedTitles(page, [...expected]);
    });
  }

  testWithFeed('delete sort in feed view restores newest-first order', async ({ page, feed }) => {
    await setSortsDirect(page, [{ fieldId: feed.fields.name, condition: SortCondition.Ascending }]);
    await expectFeedTitles(page, ['Apple', 'Banana', 'Cherry']);
    await openSortMenu(page);
    await page.getByRole('button', { name: /delete\s+(all\s+)?sorts/i }).click();
    await expectFeedTitles(page, ['Cherry', 'Apple', 'Banana']);
  });

  testWithFeed('new row appears in feed with active sort', async ({ page, feed }) => {
    await setSortsDirect(page, [{ fieldId: feed.fields.name, condition: SortCondition.Ascending }]);
    await createTitledRow(page, 'Blueberry');
    await expectFeedTitles(page, ['Apple', 'Banana', 'Blueberry', 'Cherry']);
  });

  testWithFeed('edit row in feed updates sorted position', async ({ page, feed }) => {
    await setSortsDirect(page, [{ fieldId: feed.fields.name, condition: SortCondition.Ascending }]);
    await openFeedCard(page, feed.rowIds[1]);
    await renameOpenRowDetailTitle(page, 'Zulu');
    await closeRowDetailWithEscape(page);
    await expectFeedTitles(page, ['Banana', 'Cherry', 'Zulu']);
  });

  testWithFeed('create multiple sorts in feed view', async ({ page, feed }) => {
    await addSortByFieldName(page, 'Completed');
    await addSortByFieldName(page, 'Name');
    await openSortMenu(page);
    await changeSortDirection(page, 1, SortDirection.Descending);
    await closeSortMenu(page);
    await expectFeedTitles(page, ['Apple', 'Cherry', 'Banana']);
    await setCellDirect(page, feed.rowIds[1], feed.fields.done, FieldType.Checkbox, 'Yes');
    await expectFeedTitles(page, ['Cherry', 'Banana', 'Apple']);
  });

  testWithFeed('sort persists when switching views; sort is isolated per view', async ({ page, feed }) => {
    await setSortsDirect(page, [{ fieldId: feed.fields.name, condition: SortCondition.Ascending }]);
    await expectFeedTitles(page, ['Apple', 'Banana', 'Cherry']);
    await switchToFeedOrGridView(page, feed.gridViewId, 'Grid');
    await expect(DatabaseGridSelectors.dataRows(page).first()).toContainText('Banana');
    await switchToFeedOrGridView(page, feed.feedViewId, 'Feed');
    await expectFeedTitles(page, ['Apple', 'Banana', 'Cherry']);
    await setSortsDirect(page, [{ fieldId: feed.fields.name, condition: SortCondition.Descending }]);
    await switchToFeedOrGridView(page, feed.gridViewId, 'Grid');
    await switchToFeedOrGridView(page, feed.feedViewId, 'Feed');
    await expectFeedTitles(page, ['Cherry', 'Banana', 'Apple']);
  });
});

testWithFeed.describe('Desktop Feed combined filter and sort cases', () => {
  testWithFeed('apply filter and sort in either order', async ({ page, feed }) => {
    await textFilter(page, feed.fields.name, TextFilterCondition.TextContains, 'a');
    await setSortsDirect(page, [{ fieldId: feed.fields.score, condition: SortCondition.Descending }]);
    await expectFeedTitles(page, ['Banana', 'Apple']);
    await setFiltersDirect(page, []);
    await setSortsDirect(page, []);
    await setSortsDirect(page, [{ fieldId: feed.fields.score, condition: SortCondition.Descending }]);
    await textFilter(page, feed.fields.name, TextFilterCondition.TextContains, 'a');
    await expectFeedTitles(page, ['Banana', 'Apple']);
  });

  testWithFeed('delete filter or sort while the other remains active', async ({ page, feed }) => {
    const sorts = [{ fieldId: feed.fields.name, condition: SortCondition.Descending }];

    await setSortsDirect(page, sorts);
    await textFilter(page, feed.fields.name, TextFilterCondition.TextContains, 'a');
    await expectFeedTitles(page, ['Banana', 'Apple']);
    await setFiltersDirect(page, []);
    await expectFeedTitles(page, ['Cherry', 'Banana', 'Apple']);
    await textFilter(page, feed.fields.name, TextFilterCondition.TextContains, 'a');
    await setSortsDirect(page, []);
    await expectFeedTitles(page, ['Apple', 'Banana']);
  });

  testWithFeed('change filter condition with active sort in feed view', async ({ page, feed }) => {
    await setSortsDirect(page, [{ fieldId: feed.fields.score, condition: SortCondition.Ascending }]);
    await addFilterByFieldName(page, 'Score');
    await changeFilterCondition(page, NumberFilterCondition.GreaterThan);
    await enterFilterText(page, '2');
    await expectFeedTitles(page, ['Cherry']);
    await changeFilterCondition(page, NumberFilterCondition.GreaterThanOrEqualTo);
    await page.keyboard.press('Escape');
    await expectFeedTitles(page, ['Banana', 'Cherry']);
  });

  testWithFeed('change sort direction with active filter in feed view', async ({ page, feed }) => {
    await textFilter(page, feed.fields.name, TextFilterCondition.TextContains, 'a');
    await addSortByFieldName(page, 'Name');
    await expectFeedTitles(page, ['Apple', 'Banana']);
    await openSortMenu(page);
    await changeSortDirection(page, 0, SortDirection.Descending);
    await closeSortMenu(page);
    await expectFeedTitles(page, ['Banana', 'Apple']);
  });

  testWithFeed(
    'new matching card appears in correct sorted position with filter and sort active',
    async ({ page, feed }) => {
      await textFilter(page, feed.fields.name, TextFilterCondition.TextContains, 'a');
      await setSortsDirect(page, [{ fieldId: feed.fields.name, condition: SortCondition.Ascending }]);
      await createTitledRow(page, 'Avocado');
      await expectFeedTitles(page, ['Apple', 'Avocado', 'Banana']);
    }
  );

  testWithFeed('edit row to match filter shows it in feed view with active sort', async ({ page, feed }) => {
    await setSortsDirect(page, [{ fieldId: feed.fields.name, condition: SortCondition.Ascending }]);
    await textFilter(page, feed.fields.name, TextFilterCondition.TextStartsWith, 'A');
    await expectFeedTitles(page, ['Apple']);
    await setPrimaryCellTextDirect(page, feed.rowIds[2], 'Apricot');
    await expectFeedTitles(page, ['Apple', 'Apricot']);
  });

  testWithFeed('empty then non-empty filter results with sort in feed view', async ({ page, feed }) => {
    await textFilter(page, feed.fields.name, TextFilterCondition.TextIs, 'Does not exist');
    await expectFeedTitles(page, []);
    await addSortByFieldName(page, 'Name');
    await expectFeedTitles(page, []);
    await textFilter(page, feed.fields.name, TextFilterCondition.TextIsNotEmpty);
    await expectFeedTitles(page, ['Apple', 'Banana', 'Cherry']);
  });

  testWithFeed('cross-field filter/sort combinations in feed view', async ({ page, feed }) => {
    await setFiltersDirect(page, [
      { fieldId: feed.fields.done, fieldType: FieldType.Checkbox, condition: CheckboxFilterCondition.IsChecked },
    ]);
    await setSortsDirect(page, [{ fieldId: feed.fields.score, condition: SortCondition.Descending }]);
    await expectFeedTitles(page, ['Cherry', 'Banana']);
    await setCellDirect(page, feed.rowIds[1], feed.fields.done, FieldType.Checkbox, 'Yes');
    await expectFeedTitles(page, ['Cherry', 'Banana', 'Apple']);
  });
});
