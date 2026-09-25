import { expect, test, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { CalculationType, FieldType } from '../../../src/application/database-yjs/database.type';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { waitForGridReady } from '../../support/database-ui-helpers';
import { toggleCheckbox, typeTextIntoCell } from '../../support/field-type-helpers';
import {
  closeMenus,
  ensureRowCount,
  revealColumn,
  seedColumn,
  trimRowsDirect,
} from '../../support/formula-test-helpers';
import {
  createNamedGridDatabase,
  createOneWayRelationField,
  createRollupCountFieldViaPropertyMenu,
  getCurrentDatabaseInfo,
  setRelationCellDirect,
  waitForDatabaseTestContext,
} from '../../support/relation-test-helpers';
import { GridFieldSelectors, PropertyMenuSelectors, SingleSelectSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling } from '../../support/test-config';

import type * as Yjs from 'yjs';

const { After, Given, When, Then } = createBdd();

interface RollupFixture {
  fields: Map<string, string>;
  targetUrl: string;
  targetRows: string[];
  sourceRow: string;
  rollup: string;
  editor?: Page;
  documentToken: string;
}

const fixtures = new WeakMap<Page, RollupFixture>();

function fixture(page: Page) {
  const value = fixtures.get(page);

  if (!value) throw new Error('Disposable rollup fixture is missing');
  return value;
}

async function propertyEditor(page: Page) {
  await closeMenus(page);
  await revealColumn(page, fixture(page).rollup);
  await GridFieldSelectors.fieldHeader(page, fixture(page).rollup).last().click();
  await PropertyMenuSelectors.editPropertyMenuItem(page).last().click();
  await expect(page.getByTestId('property-name-input').last()).toBeVisible();
}

async function openSubmenu(page: Page, testId: string) {
  const trigger = page.getByTestId(testId).last();

  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await page.keyboard.press('ArrowRight');
}

function valueTrigger(page: Page) {
  return page
    .getByRole('menuitem')
    .filter({ has: page.getByText('Value', { exact: true }) })
    .last();
}

async function relatedEditor(page: Page) {
  const state = fixture(page);

  if (!state.editor) {
    state.editor = await page.context().newPage();
    setupPageErrorHandling(state.editor);
    await state.editor.goto(state.targetUrl);
    await waitForGridReady(state.editor);
    await waitForDatabaseTestContext(state.editor);
  }

  return state.editor;
}

async function createFixtureGrid(page: Page, name: string, rowNames: string[], protectedIds: string[] = []) {
  await createNamedGridDatabase(page, name, [], { protectedIds });
  await ensureRowCount(page, rowNames.length);
  await trimRowsDirect(page, rowNames.length);
  const database = await getCurrentDatabaseInfo(page);

  await seedColumn(page, database.primaryFieldId, 'Text', rowNames);
  return database;
}

async function seedInputSchema(page: Page): Promise<Map<string, string>> {
  const specs = [
    { id: 'input-amount', name: 'Amount', type: FieldType.Number },
    { id: 'input-checked', name: 'Checked', type: FieldType.Checkbox },
    { id: 'input-stage', name: 'Stage', type: FieldType.SingleSelect },
    { id: 'input-tags', name: 'Tags', type: FieldType.MultiSelect },
    { id: 'input-double', name: 'Double', type: FieldType.Formula, expression: 'prop("input-amount") * 2' },
    { id: 'input-complete', name: 'Complete', type: FieldType.Formula, expression: 'prop("input-checked")' },
  ];

  // Use the established dev/test document bridge for fixture schema. The UI
  // under test is the rollup editor, not repeated input-property creation.
  await page.evaluate((specs) => {
    const win = window as unknown as {
      Y: typeof Yjs;
      __TEST_DATABASE_CONTEXT__: { databaseDoc: Yjs.Doc };
    };
    const doc = win.__TEST_DATABASE_CONTEXT__.databaseDoc;
    const database = doc.getMap<Yjs.Map<unknown>>('data').get('database');

    if (!database) throw new Error('Fixture database has not loaded');
    const fields = database.get('fields') as Yjs.Map<Yjs.Map<unknown>>;
    const views = database.get('views') as Yjs.Map<Yjs.Map<unknown>>;

    doc.transact(() => {
      for (const spec of specs) {
        const field = new win.Y.Map<unknown>();
        const option = new win.Y.Map<unknown>();
        const options = new win.Y.Map<Yjs.Map<unknown>>();

        field.set('id', spec.id);
        field.set('name', spec.name);
        field.set('ty', spec.type);
        field.set('is_primary', false);
        field.set('width', 180);
        field.set('type_option', options);
        options.set(String(spec.type), option);
        if (spec.expression) {
          option.set('expression', spec.expression);
          option.set('format', 0);
        }

        fields.set(spec.id, field);
        views.forEach((view) => {
          (view.get('field_orders') as Yjs.Array<{ id: string }>).push([{ id: spec.id }]);
          const setting = new win.Y.Map<unknown>();

          setting.set('visibility', 0);
          (view.get('field_settings') as Yjs.Map<Yjs.Map<unknown>>).set(spec.id, setting);
        });
      }
    });
  }, specs);

  return new Map(specs.map(({ name, id }) => [name, id]));
}

Given('disposable related grids contain formula and select rollup inputs', async ({ page, request }) => {
  test.setTimeout(420_000);
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await signInAndWaitForApp(page, request, generateRandomEmail());
  const target = await createFixtureGrid(page, 'Rollup Inputs', ['First', 'Second', 'Third', 'Blank']);
  const fields = await seedInputSchema(page);

  // Fixture inputs are seeded directly; every rollup configuration and later
  // source-cell edit below uses the production UI.
  for (const [name, type, values] of [
    ['Amount', 'Number', ['10', '20', '30', '<empty>']],
    ['Checked', 'Checkbox', ['Yes', 'No', 'Yes', 'No']],
    ['Stage', 'Select', ['Red', 'Blue', 'Green', '<empty>']],
    ['Tags', 'MultiSelect', ['Red, Blue', 'Red', 'Green', '<empty>']],
  ] as const) {
    const id = fields.get(name)!;

    await seedColumn(page, id, type, [...values]);
  }

  const targetUrl = page.url();
  const source = await createFixtureGrid(
    page,
    'Rollup Summary',
    ['Summary'],
    [target.databaseId, target.pageId, target.viewId]
  );

  expect(source.databaseId).not.toBe(target.databaseId);
  const relation = await createOneWayRelationField(page, {
    fieldName: 'Items',
    relatedDatabaseId: target.databaseId,
  });

  await setRelationCellDirect(page, relation, 0, target.rowIds);
  const rollup = await createRollupCountFieldViaPropertyMenu(page, {
    fieldName: 'Aggregate',
    relationFieldId: relation,
    targetFieldId: target.primaryFieldId,
  });
  const documentToken = `rollup-formula-${Date.now()}`;

  await page.evaluate((token) => {
    (window as typeof window & { __ROLLUP_FORMULA_DOCUMENT_TOKEN__?: string }).__ROLLUP_FORMULA_DOCUMENT_TOKEN__ = token;
  }, documentToken);
  fixtures.set(page, {
    fields,
    targetUrl,
    targetRows: target.rowIds,
    sourceRow: source.rowIds[0],
    rollup,
    documentToken,
  });
});

const calculations: Record<string, [string, CalculationType]> = {
  Sum: ['moreOptions', CalculationType.Sum],
  'Percent checked': ['percent', CalculationType.PercentChecked],
  'Count values': ['count', CalculationType.CountValue],
  'Percent values': ['percent', CalculationType.PercentValue],
};

When('the rollup targets {string} using {string}', async ({ page }, name: string, calculation: string) => {
  const id = fixture(page).fields.get(name);

  if (!id) throw new Error(`Unknown related property: ${name}`);
  await propertyEditor(page);
  const property = page.getByTestId('rollup-property-trigger').last();

  // Keeping the target preserves its selected options when only Calculate changes.
  if (!(await property.textContent())?.includes(name)) {
    await openSubmenu(page, 'rollup-property-trigger');
    await page.getByTestId(`rollup-property-option-${id}`).last().click();
    await propertyEditor(page);
  }

  const choice = calculations[calculation];

  if (!choice) throw new Error(`Unknown rollup calculation: ${calculation}`);
  await openSubmenu(page, 'rollup-calculate-trigger');
  await openSubmenu(page, `rollup-calculation-group-${choice[0]}`);
  await page.getByTestId(`rollup-calculation-${choice[1]}`).last().click();
  await closeMenus(page);
});

When('the rollup matches the options {string}', async ({ page }, names: string) => {
  await propertyEditor(page);
  await valueTrigger(page).focus();
  await page.keyboard.press('ArrowRight');
  for (const name of names.split(',').map((value) => value.trim())) {
    await page.getByRole('menuitem', { name, exact: true }).last().click();
  }

  await closeMenus(page);
});

Then('the rollup retains the matching options {string}', async ({ page }, names: string) => {
  await propertyEditor(page);
  for (const name of names.split(',').map((value) => value.trim())) {
    await expect(valueTrigger(page)).toContainText(name);
  }

  await closeMenus(page);
});

async function expectRollup(page: Page, expected: string) {
  const state = fixture(page);

  await revealColumn(page, state.rollup);
  await expect(page.getByTestId(`rollup-cell-${state.sourceRow}-${state.rollup}`).last()).toHaveText(expected, {
    timeout: 30_000,
  });
}

Then('the configured rollup shows {string}', async ({ page }, expected: string) => {
  await expectRollup(page, expected);
});

Then('the configured rollup shows {string} without refreshing', async ({ page }, expected: string) => {
  await expectRollup(page, expected);
  expect(
    await page.evaluate(
      () => (window as typeof window & { __ROLLUP_FORMULA_DOCUMENT_TOKEN__?: string }).__ROLLUP_FORMULA_DOCUMENT_TOKEN__
    )
  ).toBe(fixture(page).documentToken);
});

When('the rollup page is reloaded', async ({ page }) => {
  await page.reload();
  await waitForGridReady(page);
  await waitForDatabaseTestContext(page);
  const token = `rollup-formula-${Date.now()}`;

  fixture(page).documentToken = token;
  await page.evaluate((value) => {
    (window as typeof window & { __ROLLUP_FORMULA_DOCUMENT_TOKEN__?: string }).__ROLLUP_FORMULA_DOCUMENT_TOKEN__ = value;
  }, token);
});

async function selectRelatedOption(page: Page, name: string, row: number, option: string) {
  const state = fixture(page);
  const editor = await relatedEditor(page);
  const id = state.fields.get(name);

  if (!id) throw new Error(`Unknown input: ${name}`);
  await revealColumn(editor, id);
  await SingleSelectSelectors.selectOptionCell(editor, state.targetRows[row - 1], id).click();
  await SingleSelectSelectors.selectOptionMenu(editor).getByText(option, { exact: true }).click();
  await closeMenus(editor);
}

When(
  'another tab adds {string} to {string} in related row {int}',
  async ({ page }, option: string, name: string, row: number) => {
    await selectRelatedOption(page, name, row, option);
  }
);

When(
  'another tab selects {string} for {string} in related row {int}',
  async ({ page }, option: string, name: string, row: number) => {
    await selectRelatedOption(page, name, row, option);
  }
);

When('another tab changes the related amount in row {int} to {string}', async ({ page }, row: number, value: string) => {
  const editor = await relatedEditor(page);
  const id = fixture(page).fields.get('Amount')!;

  await revealColumn(editor, id);
  await typeTextIntoCell(editor, id, row - 1, value);
});

When('another tab toggles the related checkbox in row {int}', async ({ page }, row: number) => {
  const editor = await relatedEditor(page);
  const id = fixture(page).fields.get('Checked')!;

  await revealColumn(editor, id);
  await toggleCheckbox(editor, id, row - 1);
});

After({ tags: '@rollup-formula-select' }, async ({ page }) => {
  await fixtures.get(page)?.editor?.close();
  fixtures.delete(page);
});
