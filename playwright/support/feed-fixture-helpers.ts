import { expect, Page } from '@playwright/test';

import { FieldType } from '../../src/application/database-yjs/database.type';

import { activeDatabaseViewId, getActiveRowIds, seedPrimaryTitlesDirect } from './gallery-test-helpers';
import { createFieldDirect, setCellDirect } from './gallery-test-helpers';
import { getPrimaryFieldId } from './filter-test-helpers';
import { setRowCreatedAtDirect } from './feed-test-helpers';
import { appendRowToCurrentDatabaseDirect, waitForDatabaseTestContext } from './relation-test-helpers';

/** Web equivalent of the desktop .afdb fixtures: real row collabs with known field values. */
export async function seedFeedConditions(page: Page) {
  const gridViewId = await activeDatabaseViewId(page);
  const rowIds = await getActiveRowIds(page);
  const name = await getPrimaryFieldId(page);
  const score = await createFieldDirect(page, { name: 'Score', fieldType: FieldType.Number });
  const done = await createFieldDirect(page, { name: 'Completed', fieldType: FieldType.Checkbox });
  const status = await createFieldDirect(page, {
    name: 'Choice',
    fieldType: FieldType.SingleSelect,
    selectOptions: [
      { id: 'red', name: 'Red' },
      { id: 'blue', name: 'Blue' },
    ],
  });
  const date = await createFieldDirect(page, { name: 'Date', fieldType: FieldType.DateTime });

  await seedPrimaryTitlesDirect(page, ['Banana', 'Apple', 'Cherry']);
  for (const [index, rowId] of rowIds.entries()) {
    await setRowCreatedAtDirect(page, rowId, 1_700_000_000 + index * 60);
    await setCellDirect(page, rowId, score, FieldType.Number, ['2', '1', '3'][index]);
    await setCellDirect(page, rowId, done, FieldType.Checkbox, ['Yes', 'No', 'Yes'][index]);
    await setCellDirect(page, rowId, status, FieldType.SingleSelect, ['red', '', 'blue'][index]);
    await setCellDirect(page, rowId, date, FieldType.DateTime, String(1_700_000_000 + [2, 1, 3][index] * 86400));
  }

  return { gridViewId, rowIds, fields: { name, score, done, status, date } };
}

export async function seedFeedHundredRows(page: Page) {
  await waitForDatabaseTestContext(page);
  const existing = await getActiveRowIds(page);

  // Native list.afdb import is unavailable on Web. Seed the same 100-record
  // boundary through real row documents, then exercise the production Feed UI.
  for (let index = existing.length; index < 100; index++) {
    await appendRowToCurrentDatabaseDirect(page, `Feed Item ${index + 1}`);
  }

  await expect.poll(() => getActiveRowIds(page), { timeout: 60_000 }).toHaveLength(100);
  await seedPrimaryTitlesDirect(
    page,
    Array.from({ length: 100 }, (_, index) => `Feed Item ${index + 1}`)
  );
  return getActiveRowIds(page);
}
