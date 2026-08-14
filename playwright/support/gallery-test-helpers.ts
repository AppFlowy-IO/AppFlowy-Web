import { expect, type Locator, type Page } from '@playwright/test';
import { v5 as uuidv5 } from 'uuid';

import { FieldType, RowMetaKey, SortCondition } from '../../src/application/database-yjs/database.type';
import { GalleryCardPreview, GalleryCardSize, RowCoverType } from '../../src/application/types';
import { waitForDatabaseTestContext } from './relation-test-helpers';
import { closeRowDetailWithEscape } from './row-detail-helpers';
import { DatabaseGallerySelectors, DatabaseViewSelectors, RowDetailSelectors } from './selectors';

export type GalleryFieldInfo = {
  id: string;
  isPrimary: boolean;
  name: string;
  type: FieldType;
  visibility: number;
};

export type DirectFilter = {
  condition: number;
  content?: string;
  fieldId: string;
  fieldType: FieldType;
};

export type DirectSort = {
  condition: SortCondition;
  fieldId: string;
};

export async function databaseViewIds(page: Page): Promise<string[]> {
  return DatabaseViewSelectors.viewTab(page).evaluateAll((tabs) =>
    tabs
      .map((tab) => tab.getAttribute('data-testid')?.replace(/^view-tab-/, ''))
      .filter((viewId): viewId is string => Boolean(viewId))
  );
}

export async function activeDatabaseViewId(page: Page): Promise<string> {
  const testId = await DatabaseViewSelectors.activeViewTab(page).getAttribute('data-testid');

  if (!testId?.startsWith('view-tab-')) throw new Error(`Unable to read the active database view from ${testId}`);
  return testId.slice('view-tab-'.length);
}

export async function addGalleryView(page: Page): Promise<string> {
  const previousViewIds = new Set(await databaseViewIds(page));

  await DatabaseViewSelectors.addViewButton(page).click();
  const option = page.getByTestId('add-gallery-view-button');

  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();

  let galleryViewId = '';

  await expect
    .poll(
      async () => {
        galleryViewId = (await databaseViewIds(page)).find((viewId) => !previousViewIds.has(viewId)) ?? '';
        return galleryViewId;
      },
      { timeout: 20_000 }
    )
    .not.toBe('');
  await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute('data-testid', `view-tab-${galleryViewId}`);
  await expect(DatabaseGallerySelectors.gallery(page)).toBeVisible({ timeout: 30_000 });
  return galleryViewId;
}

export async function switchToDatabaseView(page: Page, viewId: string, layout: 'Gallery' | 'Grid'): Promise<void> {
  await DatabaseViewSelectors.viewTab(page, viewId).click();
  await expect(DatabaseViewSelectors.activeViewTab(page)).toHaveAttribute('data-testid', `view-tab-${viewId}`);

  if (layout === 'Gallery') {
    await expect(DatabaseGallerySelectors.gallery(page)).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(DatabaseViewSelectors.gridView(page)).toBeVisible({ timeout: 30_000 });
  }
}

export async function getActiveDatabaseFields(page: Page): Promise<GalleryFieldInfo[]> {
  await waitForDatabaseTestContext(page);
  return page.evaluate(() => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const view = database.get('views').get(ctx.activeViewId);
    const fields = database.get('fields');
    const settings = view.get('field_settings');

    return view
      .get('field_orders')
      .toArray()
      .map(({ id }: { id: string }) => {
        const field = fields.get(id);

        return {
          id,
          isPrimary: Boolean(field?.get('is_primary')),
          name: String(field?.get('name') ?? ''),
          type: Number(field?.get('ty')),
          visibility: Number(settings?.get(id)?.get('visibility') ?? 0),
        };
      });
  });
}

export async function getActiveRowIds(page: Page): Promise<string[]> {
  await waitForDatabaseTestContext(page);
  return page.evaluate(() => {
    const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const view = database.get('views').get(ctx.activeViewId);

    return view
      .get('row_orders')
      .toArray()
      .filter((row: { is_deleted?: boolean }) => !row.is_deleted)
      .map((row: { id: string }) => row.id);
  });
}

export async function seedPrimaryTitlesDirect(page: Page, titles: string[]): Promise<string[]> {
  await waitForDatabaseTestContext(page);
  return page.evaluate(async (rowTitles) => {
    const win = window as any;
    const ctx = win.__TEST_DATABASE_CONTEXT__;
    const Y = win.Y;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const view = database.get('views').get(ctx.activeViewId);
    const fields = database.get('fields');
    const fieldOrders = view.get('field_orders').toArray() as Array<{ id: string }>;
    const primaryFieldId =
      fieldOrders.find(({ id }) => Boolean(fields.get(id)?.get('is_primary')))?.id ?? fieldOrders[0]?.id;
    const activeRows = (view.get('row_orders').toArray() as Array<{ id: string; is_deleted?: boolean }>).filter(
      (row) => !row.is_deleted
    );

    if (!primaryFieldId) throw new Error('Cannot seed Gallery titles without a primary field');
    if (activeRows.length < rowTitles.length) {
      throw new Error(`Expected at least ${rowTitles.length} Gallery rows, got ${activeRows.length}`);
    }

    for (let index = 0; index < rowTitles.length; index += 1) {
      const rowId = activeRows[index].id;
      const rowDoc = ctx.rowMap?.[rowId] ?? (await ctx.ensureRow?.(rowId));

      if (!rowDoc) throw new Error(`Row ${rowId} was not available for Gallery title seeding`);
      rowDoc.transact(() => {
        const row = rowDoc.getMap('data').get('data');
        const cells = row.get('cells');
        let cell = cells.get(primaryFieldId);

        if (!cell) {
          cell = new Y.Map();
          cells.set(primaryFieldId, cell);
        }

        const now = String(Math.floor(Date.now() / 1000) + index);

        cell.set('data', rowTitles[index]);
        cell.set('field_type', 0);
        cell.set('created_at', cell.get('created_at') || now);
        cell.set('last_modified', now);
        row.set('last_modified', now);
      });
    }

    return activeRows.slice(0, rowTitles.length).map((row) => row.id);
  }, titles);
}

export async function expectGalleryTitles(page: Page, titles: string[]): Promise<void> {
  await expect(DatabaseGallerySelectors.titles(page)).toHaveCount(titles.length, { timeout: 20_000 });
  await expect(DatabaseGallerySelectors.titles(page)).toHaveText(titles, { timeout: 20_000 });
}

export async function addRowsFromGallery(page: Page, count: number): Promise<void> {
  const initialCount = (await getActiveRowIds(page)).length;

  for (let index = 0; index < count; index += 1) {
    await DatabaseGallerySelectors.newRowButton(page).scrollIntoViewIfNeeded();
    await DatabaseGallerySelectors.newRowButton(page).click();
    await expect.poll(() => getActiveRowIds(page), { timeout: 15_000 }).toHaveLength(initialCount + index + 1);
  }
}

export async function openGallerySettings(page: Page): Promise<void> {
  const galleryTrigger = DatabaseGallerySelectors.settingsTrigger(page);

  if (!(await galleryTrigger.isVisible().catch(() => false))) {
    await page.getByTestId('database-actions-settings').click();
  }

  await expect(galleryTrigger).toBeVisible({ timeout: 10_000 });
  await galleryTrigger.click();
  await expect(DatabaseGallerySelectors.settingsMenu(page)).toBeVisible({ timeout: 10_000 });
}

async function movePointerIntoSubmenu(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();

  if (!box) throw new Error('Gallery settings submenu trigger has no layout box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
}

export async function chooseGalleryCardSize(page: Page, size: GalleryCardSize): Promise<void> {
  const label = {
    [GalleryCardSize.Small]: 'small',
    [GalleryCardSize.Medium]: 'medium',
    [GalleryCardSize.Large]: 'large',
  }[size];

  await movePointerIntoSubmenu(page, page.getByTestId('gallery-card-size-trigger'));
  await expect(page.getByTestId('gallery-card-size-menu')).toBeVisible();
  await page.getByTestId(`gallery-card-size-${label}`).click();
  await expect(DatabaseGallerySelectors.grid(page)).toHaveAttribute('data-card-size', String(size));
}

export async function chooseGalleryCardPreview(page: Page, preview: GalleryCardPreview): Promise<void> {
  await movePointerIntoSubmenu(page, page.getByTestId('gallery-card-preview-trigger'));
  await expect(page.getByTestId('gallery-card-preview-menu')).toBeVisible();
  await page.getByTestId(`gallery-card-preview-${preview}`).click();
  await expect(DatabaseGallerySelectors.grid(page).locator('[data-gallery-preview]').first()).toHaveAttribute(
    'data-gallery-preview',
    String(preview)
  );
}

export async function toggleGalleryFitImage(page: Page): Promise<boolean> {
  const toggle = page.getByTestId('gallery-fit-image-switch');
  const before = (await toggle.getAttribute('data-state')) === 'checked';

  await page.getByTestId('gallery-fit-image-toggle').click();
  await expect(toggle).toHaveAttribute('data-state', before ? 'unchecked' : 'checked');
  return !before;
}

export async function closeDatabaseMenus(page: Page): Promise<void> {
  for (let index = 0; index < 4; index += 1) await page.keyboard.press('Escape');
  await expect(
    page.locator('[data-slot="dropdown-menu-content"]:visible, [data-slot="dropdown-menu-sub-content"]:visible')
  ).toHaveCount(0);
}

export async function openGalleryRow(page: Page, rowId: string): Promise<Locator> {
  await DatabaseGallerySelectors.cardByRowId(page, rowId).click();
  const modal = RowDetailSelectors.modal(page).last();

  await expect(modal).toBeVisible({ timeout: 15_000 });
  return modal;
}

export async function chooseGalleryRowEmoji(page: Page, rowId: string, emojiIndex = 0): Promise<string> {
  const rowDetail = await openGalleryRow(page, rowId);

  await rowDetail.getByTestId('row-title-input').hover();
  const existingIcon = rowDetail.locator('.view-icon').first();

  if (await existingIcon.isVisible().catch(() => false)) {
    await existingIcon.click();
  } else {
    await rowDetail.getByTestId('add-icon-button').click();
  }

  await page.getByTestId('icon-popover-tab-emoji').click();
  const emojiButton = page.locator('.emoji-picker button.text-xl').nth(emojiIndex);

  await expect(emojiButton).toBeVisible({ timeout: 15_000 });
  const emoji = (await emojiButton.textContent())?.trim() ?? '';

  if (!emoji) throw new Error('The emoji picker did not expose an emoji');
  await emojiButton.click();
  await closeRowDetailWithEscape(page);
  await expect(DatabaseGallerySelectors.titleByRowId(page, rowId)).toContainText(emoji);
  return emoji;
}

export async function createFieldDirect(
  page: Page,
  options: {
    fieldType: FieldType;
    name: string;
    selectOptions?: Array<{ color?: string; id: string; name: string }>;
    visibleInGallery?: boolean;
  }
): Promise<string> {
  await waitForDatabaseTestContext(page);
  return page.evaluate((fieldOptions) => {
    const win = window as any;
    const ctx = win.__TEST_DATABASE_CONTEXT__;
    const Y = win.Y;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const fieldId = crypto.randomUUID();
    const now = String(Math.floor(Date.now() / 1000));
    const field = new Y.Map();
    const typeOptionMap = new Y.Map();
    const typeOption = new Y.Map();

    field.set('name', fieldOptions.name);
    field.set('id', fieldId);
    field.set('ty', fieldOptions.fieldType);
    field.set('created_at', now);
    field.set('last_modified', now);
    field.set('is_primary', false);
    field.set('icon', '');

    if (fieldOptions.selectOptions) {
      typeOption.set(
        'content',
        JSON.stringify({
          disable_color: false,
          options: fieldOptions.selectOptions.map((option, index) => ({
            color:
              option.color ??
              ['Purple', 'Pink', 'LightPink', 'Orange', 'Yellow', 'Lime', 'Green', 'Aqua', 'Blue', 'Cream'][index % 10],
            id: option.id,
            name: option.name,
          })),
        })
      );
      typeOptionMap.set(String(fieldOptions.fieldType), typeOption);
      field.set('type_option', typeOptionMap);
    }

    ctx.databaseDoc.transact(() => {
      database.get('fields').set(fieldId, field);
      database.get('views').forEach((view: any) => {
        view.get('field_orders').push([{ id: fieldId }]);
        const setting = new Y.Map();

        setting.set('visibility', Number(view.get('layout')) === 5 && !fieldOptions.visibleInGallery ? 2 : 0);
        setting.set('wrap', 0);
        view.get('field_settings').set(fieldId, setting);
      });
    });

    return fieldId;
  }, options);
}

export async function setCellDirect(
  page: Page,
  rowId: string,
  fieldId: string,
  fieldType: FieldType,
  data: unknown,
  extras: Record<string, unknown> = {}
): Promise<void> {
  await waitForDatabaseTestContext(page);
  await page.evaluate(
    async ({ data, extras, fieldId, fieldType, rowId }) => {
      const win = window as any;
      const ctx = win.__TEST_DATABASE_CONTEXT__;
      const Y = win.Y;
      const rowDoc = ctx.rowMap?.[rowId] ?? (await ctx.ensureRow?.(rowId));

      if (!rowDoc) throw new Error(`Row ${rowId} was unavailable`);
      rowDoc.transact(() => {
        const row = rowDoc.getMap('data').get('data');
        const cells = row.get('cells');
        let cell = cells.get(fieldId);

        if (!cell) {
          cell = new Y.Map();
          cells.set(fieldId, cell);
        }

        const now = String(Math.floor(Date.now() / 1000));

        if (fieldType === 14 && Array.isArray(data)) {
          const media = new Y.Array();

          media.push(data.map((item) => JSON.stringify(item)));
          cell.set('data', media);
        } else {
          cell.set('data', data);
        }
        cell.set('field_type', fieldType);
        cell.set('created_at', cell.get('created_at') || now);
        cell.set('last_modified', now);
        Object.entries(extras).forEach(([key, value]) => cell.set(key, value));
        row.set('last_modified', now);
      });
    },
    { data, extras, fieldId, fieldType, rowId }
  );
}

export async function setFiltersDirect(
  page: Page,
  filtersToSet: DirectFilter[],
  options: { advanced?: boolean } = {}
): Promise<void> {
  await waitForDatabaseTestContext(page);
  await page.evaluate(
    ({ advanced, filtersToSet }) => {
      const win = window as any;
      const ctx = win.__TEST_DATABASE_CONTEXT__;
      const Y = win.Y;
      const database = ctx.databaseDoc.getMap('data').get('database');
      const view = database.get('views').get(ctx.activeViewId);
      let filters = view.get('filters');

      if (!filters) {
        filters = new Y.Array();
        view.set('filters', filters);
      }

      const createFilter = (value: (typeof filtersToSet)[number], index: number) => {
        const filter = new Y.Map();

        filter.set('id', `gallery_filter_${Date.now()}_${index}`);
        filter.set('field_id', value.fieldId);
        filter.set('condition', value.condition);
        filter.set('content', value.content ?? '');
        filter.set('ty', value.fieldType);
        filter.set('filter_type', 2);
        return filter;
      };

      filters.delete(0, filters.length);
      if (advanced && filtersToSet.length > 0) {
        const root = new Y.Map();
        const children = new Y.Array();

        root.set('id', `gallery_filter_root_${Date.now()}`);
        root.set('filter_type', 0);
        children.push(filtersToSet.map(createFilter));
        root.set('children', children);
        filters.push([root]);
      } else if (filtersToSet.length > 0) {
        filters.push(filtersToSet.map(createFilter));
      }
    },
    { advanced: options.advanced ?? false, filtersToSet }
  );
}

export async function setSortsDirect(page: Page, sortsToSet: DirectSort[]): Promise<void> {
  await waitForDatabaseTestContext(page);
  await page.evaluate((sortsToSet) => {
    const win = window as any;
    const ctx = win.__TEST_DATABASE_CONTEXT__;
    const Y = win.Y;
    const database = ctx.databaseDoc.getMap('data').get('database');
    const view = database.get('views').get(ctx.activeViewId);
    let sorts = view.get('sorts');

    if (!sorts) {
      sorts = new Y.Array();
      view.set('sorts', sorts);
    }

    sorts.delete(0, sorts.length);
    if (sortsToSet.length > 0) {
      sorts.push(
        sortsToSet.map((value, index) => {
          const sort = new Y.Map();

          sort.set('id', `gallery_sort_${Date.now()}_${index}`);
          sort.set('field_id', value.fieldId);
          sort.set('condition', value.condition);
          return sort;
        })
      );
    }
  }, sortsToSet);
}

export async function setGalleryRowMetaDirect(
  page: Page,
  rowId: string,
  values: {
    cover?: { data: string; coverType?: RowCoverType; offset?: number } | null;
    icon?: string | null;
    isDocumentEmpty?: boolean;
  }
): Promise<void> {
  const keys = {
    cover: uuidv5(RowMetaKey.CoverId, rowId),
    icon: uuidv5(RowMetaKey.IconId, rowId),
    isDocumentEmpty: uuidv5(RowMetaKey.IsDocumentEmpty, rowId),
  };

  await waitForDatabaseTestContext(page);
  await page.evaluate(
    async ({ keys, rowId, values }) => {
      const ctx = (window as any).__TEST_DATABASE_CONTEXT__;
      const rowDoc = ctx.rowMap?.[rowId] ?? (await ctx.ensureRow?.(rowId));

      if (!rowDoc) throw new Error(`Row ${rowId} was unavailable`);
      rowDoc.transact(() => {
        const meta = rowDoc.getMap('data').get('meta');

        if ('icon' in values) {
          if (values.icon) meta.set(keys.icon, values.icon);
          else meta.delete(keys.icon);
        }
        if ('cover' in values) {
          if (values.cover) {
            meta.set(
              keys.cover,
              JSON.stringify({
                cover_type: values.cover.coverType ?? 2,
                data: values.cover.data,
                offset: values.cover.offset,
              })
            );
          } else {
            meta.delete(keys.cover);
          }
        }
        if (values.isDocumentEmpty !== undefined) meta.set(keys.isDocumentEmpty, values.isDocumentEmpty);
      });
    },
    { keys, rowId, values }
  );
}
