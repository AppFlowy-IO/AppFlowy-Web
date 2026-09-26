import { expect, test, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { CalculationType, FieldType } from '../../../src/application/database-yjs/database.type';
import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { waitForGridReady } from '../../support/database-ui-helpers';
import { toggleCheckbox, typeTextIntoCell } from '../../support/field-type-helpers';
import {
  closeMenus,
  addFormulaField,
  ensureRowCount,
  expectFormulaCells,
  expectFormulaSource,
  openFormulaEditorFromMenu,
  revealColumn,
  saveFormula,
  seedColumn,
  trimRowsDirect,
  typeFormula,
} from '../../support/formula-test-helpers';
import {
  createNamedGridDatabase,
  createOneWayRelationField,
  createRollupCountFieldViaPropertyMenu,
  getCurrentDatabaseInfo,
  getRelationCellRowIdsDirect,
  openRelationCellMenu,
  closeRelationMenu,
  selectRelationRowById,
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
  relation?: string;
  rowNames?: string[];
  summaryFormula?: string;
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

type InputSpec = { id: string; name: string; type: FieldType; expression?: string };

async function seedInputSchema(
  page: Page,
  specs: InputSpec[] = [
    { id: 'input-amount', name: 'Amount', type: FieldType.Number },
    { id: 'input-checked', name: 'Checked', type: FieldType.Checkbox },
    { id: 'input-stage', name: 'Stage', type: FieldType.SingleSelect },
    { id: 'input-tags', name: 'Tags', type: FieldType.MultiSelect },
    { id: 'input-double', name: 'Double', type: FieldType.Formula, expression: 'prop("input-amount") * 2' },
    { id: 'input-complete', name: 'Complete', type: FieldType.Formula, expression: 'prop("input-checked")' },
  ]
): Promise<Map<string, string>> {
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
  'Count checked': ['count', CalculationType.CountChecked],
};

When('the rollup targets {string} using {string}', async ({ page }, name: string, calculation: string) => {
  const id = fixture(page).fields.get(name);

  if (!id) throw new Error(`Unknown related property: ${name}`);
  await propertyEditor(page);
  const property = page.getByTestId('rollup-property-trigger').last();

  // Keeping the target preserves its selected options when only Calculate changes.
  if (!(await property.getByText(name, { exact: true }).count())) {
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
  const cell = page.getByTestId(`rollup-cell-${state.sourceRow}-${state.rollup}`).last();

  await expect(cell).toHaveText(expected, {
    timeout: 30_000,
  });
  if (expected === '') {
    // The cell has no loading attribute. A sustained blank after the preceding
    // nonempty assertion prevents a transient render from satisfying emptiness.
    let emptySince: number | undefined;

    await expect.poll(async () => {
      if ((await cell.textContent()) !== '') {
        emptySince = undefined;
        return false;
      }

      emptySince ??= Date.now();
      return Date.now() - emptySince >= 600;
    }, { timeout: 30_000, intervals: [100] }).toBe(true);
  }
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

Given('disposable related grids contain the {string} formula workflow', async ({ page, request }, workflow: string) => {
  test.setTimeout(420_000);
  setupPageErrorHandling(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await signInAndWaitForApp(page, request, generateRandomEmail());
  const expenses = workflow === 'expenses';
  const research = workflow === 'research tasks';

  expect(['project effort', 'research tasks', 'expenses']).toContain(workflow);
  const names = expenses
    ? ['Venue', 'Catering', 'Equipment', 'Unrelated expense']
    : research
    ? ['Design homepage', 'Build frontend', 'QA testing', 'Unspecified', 'Unrelated task']
    : ['Write brief', 'Implement', 'Unspecified', 'Unrelated task'];
  const target = await createFixtureGrid(page, expenses ? 'Expenses' : 'Tasks', names);
  const specs: InputSpec[] = expenses
    ? [
        { id: 'unit-price', name: 'Unit price', type: FieldType.Number },
        { id: 'quantity', name: 'Quantity', type: FieldType.Number },
        {
          id: 'expense-amount',
          name: 'Expense amount',
          type: FieldType.Formula,
          expression: 'prop("unit-price") * prop("quantity")',
        },
      ]
    : [
        { id: 'hours', name: 'Hours', type: FieldType.Number },
        { id: 'stage', name: 'Stage', type: FieldType.SingleSelect },
        { id: 'priority', name: 'Priority', type: FieldType.SingleSelect },
        {
          id: 'completed-hours',
          name: 'Completed hours',
          type: FieldType.Formula,
          expression: 'if(prop("stage") == "Done", prop("hours"), 0)',
        },
        { id: 'complete', name: 'Complete', type: FieldType.Formula, expression: 'prop("stage") == "Done"' },
        {
          id: 'completed-task',
          name: 'Completed task',
          type: FieldType.Formula,
          expression: 'if(prop("stage") == "Done", 1, 0)',
        },
        {
          id: 'high-unfinished',
          name: 'High priority unfinished',
          type: FieldType.Formula,
          expression: 'if(prop("priority") == "High" and prop("stage") != "Done", 1, 0)',
        },
      ];
  const fields = await seedInputSchema(page, specs);

  if (expenses) {
    await seedColumn(page, fields.get('Unit price')!, 'Number', ['250', '80', '300', '9999']);
    await seedColumn(page, fields.get('Quantity')!, 'Number', ['4', '10', '1', '100']);
  } else {
    await seedColumn(
      page,
      fields.get('Hours')!,
      'Number',
      research ? ['8', '20', '6', '0', '100'] : ['8', '16', '0', '100']
    );
    await seedColumn(
      page,
      fields.get('Stage')!,
      'Select',
      research ? ['Done', 'Done', 'In progress', '<empty>', 'Done'] : ['Done', 'In progress', '<empty>', 'Done']
    );
    await seedColumn(
      page,
      fields.get('Priority')!,
      'Select',
      research ? ['High', 'Low', 'High', '<empty>', 'High'] : ['High', 'Low', '<empty>', 'High']
    );
  }

  const targetUrl = page.url();
  const source = await createFixtureGrid(
    page,
    'Projects',
    ['Website'],
    [target.databaseId, target.pageId, target.viewId]
  );
  const relation = await createOneWayRelationField(page, {
    fieldName: expenses ? 'Expenses' : 'Tasks',
    relatedDatabaseId: target.databaseId,
  });

  await setRelationCellDirect(page, relation, 0, target.rowIds.slice(0, expenses || research ? 3 : 2));
  const rollup = await createRollupCountFieldViaPropertyMenu(page, {
    fieldName: 'Aggregate',
    relationFieldId: relation,
    targetFieldId: target.primaryFieldId,
  });
  const documentToken = `rollup-workflow-${Date.now()}`;

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
    relation,
    rowNames: names,
  });
});

When('the project adds a formula that summarizes completed hours', async ({ page }) => {
  fixture(page).summaryFormula = await addFormulaField(
    page,
    'Status summary',
    'format(prop("Aggregate")) + " hours done"'
  );
});

When('the project adds a formula for the remaining budget', async ({ page }) => {
  fixture(page).summaryFormula = await addFormulaField(page, 'Remaining budget', '3000 - prop("Aggregate")');
});

Then('the project summary formula shows {string}', async ({ page }, expected: string) => {
  const id = fixture(page).summaryFormula;

  if (!id) throw new Error('The project summary formula has not been created');
  await revealColumn(page, id);
  await expectFormulaCells(page, id, [expected]);
});

Then(
  'the related formula {string} retains the expression {string} after reload',
  async ({ page }, name: string, expression: string) => {
    const editor = await relatedEditor(page);
    const id = fixture(page).fields.get(name);

    if (!id) throw new Error(`Unknown formula: ${name}`);
    await editor.reload();
    await waitForGridReady(editor);
    await waitForDatabaseTestContext(editor);
    await revealColumn(editor, id);
    await openFormulaEditorFromMenu(editor, id);
    await expectFormulaSource(editor, expression);
    await editor.getByTestId('formula-editor-cancel').click();
  }
);

When(
  'another tab changes {string} in related row {int} to {string}',
  async ({ page }, name: string, row: number, value: string) => {
    const editor = await relatedEditor(page);
    const id = fixture(page).fields.get(name);

    if (!id) throw new Error(`Unknown input: ${name}`);
    await revealColumn(editor, id);
    await typeTextIntoCell(editor, id, row - 1, value);
  }
);

When('another tab changes the {string} formula to {string}', async ({ page }, name: string, expression: string) => {
  const editor = await relatedEditor(page);
  const id = fixture(page).fields.get(name);

  if (!id) throw new Error(`Unknown formula: ${name}`);
  await closeMenus(editor);
  await revealColumn(editor, id);
  await openFormulaEditorFromMenu(editor, id);
  await typeFormula(editor, expression);
  await saveFormula(editor);
});

When('the project {word} the related row {string}', async ({ page }, action: string, name: string) => {
  const state = fixture(page);
  const index = state.rowNames?.indexOf(name) ?? -1;

  expect(['links', 'unlinks']).toContain(action);
  if (!state.relation || index < 0) throw new Error(`Unknown workflow relation or row: ${name}`);
  const rowId = state.targetRows[index];

  await closeMenus(page);
  await revealColumn(page, state.relation);
  await openRelationCellMenu(page, state.relation, 0);
  if (action === 'links') {
    await selectRelationRowById(page, rowId, name);
  } else {
    const option = page.locator('[data-radix-popper-content-wrapper]').last().locator(`[data-row-id="${rowId}"]`);

    await option.hover();
    await option.locator('..').getByRole('button').click();
  }

  await expect
    .poll(async () => (await getRelationCellRowIdsDirect(page, state.relation!, state.sourceRow)).includes(rowId))
    .toBe(action === 'links');
  await closeRelationMenu(page);
});

Then(
  'the rollup retains target {string} and calculation {string}',
  async ({ page }, target: string, calculation: string) => {
    await propertyEditor(page);
    await expect(page.getByTestId('rollup-property-trigger').last().getByText(target, { exact: true })).toBeVisible();
    await expect(
      page.getByTestId('rollup-calculate-trigger').last().getByText(calculation, { exact: true })
    ).toBeVisible();
    await closeMenus(page);
  }
);

After({ tags: '@rollup-formula-select' }, async ({ page }) => {
  await fixtures.get(page)?.editor?.close();
  fixtures.delete(page);
});
