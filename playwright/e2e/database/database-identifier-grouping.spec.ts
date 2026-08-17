/**
 * Relation and Person grouping coverage for multi-value identifier fields.
 *
 * Both scenarios use Nathan's seeded workspaces without changing a shared
 * database view. Relation grouping creates and deletes a temporary view of the
 * seeded 03_epics database. Person grouping creates and deletes a temporary
 * database populated with the real workspace member IDs. Number grouping
 * remains covered by database-grid-grouping.spec.ts.
 */
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { waitForGridReady } from '../../support/database-ui-helpers';
import { openPageByExactText } from '../../support/duplicate-test-helpers';
import { addFieldWithType, setupFieldTypeTest } from '../../support/field-type-helpers';
import { createNamedGridDatabase } from '../../support/relation-test-helpers';
import {
  DatabaseViewSelectors,
  FieldType,
  HeaderSelectors,
  ModalSelectors,
  ViewActionSelectors,
  WorkspaceSelectors,
} from '../../support/selectors';
import { expandSpaceByName } from '../../support/page/flows';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';

const SEEDED_USER_EMAIL = process.env.SEEDED_USER_EMAIL || 'nathan@appflowy.io';
const SEEDED_USER_PASSWORD = process.env.SEEDED_USER_PASSWORD || 'AppFlowy!@123';
const PERSON_WORKSPACE_NAME = 'nathan workspace';
const RELATION_WORKSPACE_NAME = 'project_templates';
const RELATION_SPACE_NAME = 'Project Management';
const RELATION_DATABASE_NAME = '03_epics';

const gridGroupHeaders = (page: Page) => page.locator('[data-testid^="grid-group-header-"]');

async function openGridGroupSettings(page: Page) {
  await page.getByTestId('database-actions-settings').click();
  await page.getByTestId('grid-group-settings-trigger').click();
  await expect(page.getByTestId('grid-group-settings-menu')).toBeVisible();
}

async function groupGridByField(page: Page, fieldId: string) {
  await openGridGroupSettings(page);
  await page.getByTestId(`grid-group-by-field-${fieldId}`).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(gridGroupHeaders(page).first()).toBeVisible({ timeout: 20000 });
}

async function expectRowInExactlyTheseGroups(row: Locator, expectedGroupIds: string[]) {
  await expect(row).toHaveCount(expectedGroupIds.length);
  const actualGroupIds = await row.evaluateAll((rows) =>
    rows.map((element) => {
      const key = element.getAttribute('data-row-key') || '';
      const match = /^group:(.*):row:/.exec(key);

      if (!match) throw new Error(`Grouped row has an invalid data-row-key: ${key}`);
      return match[1];
    })
  );

  expect([...actualGroupIds].sort()).toEqual([...expectedGroupIds].sort());
}

type ExpectedGridGroupDisplay = {
  groupId: string;
  label: string;
  rows: Array<{ rowId: string; title: string }>;
};

async function expectFinalGroupedGridDisplay(
  page: Page,
  expectedGroups: ExpectedGridGroupDisplay[],
  options: { exactGroups?: boolean } = {}
) {
  const exactGroups = options.exactGroups ?? true;

  if (exactGroups) {
    await expect(gridGroupHeaders(page)).toHaveCount(expectedGroups.length);
    await expect
      .poll(() =>
        gridGroupHeaders(page).evaluateAll((headers) =>
          headers.map((header) => header.getAttribute('data-group-id') || '').sort()
        )
      )
      .toEqual(expectedGroups.map(({ groupId }) => groupId).sort());
  }

  const expectedRowKeys: string[] = [];

  for (const group of expectedGroups) {
    const header = page.getByTestId(`grid-group-header-${group.groupId}`);

    await expect(header).toBeVisible();
    await expect(header.getByText(group.label, { exact: true })).toBeVisible();
    await expect(header.getByTestId('grid-group-row-count')).toHaveText(String(group.rows.length));

    for (const row of group.rows) {
      const rowKey = `group:${group.groupId}:row:${row.rowId}`;
      const renderedRow = page.locator(`[data-testid="grid-row-${row.rowId}"][data-row-key="${rowKey}"]`);

      expectedRowKeys.push(rowKey);
      await expect(renderedRow).toHaveCount(1);
      await expect(renderedRow).toContainText(row.title);
    }
  }

  if (exactGroups) {
    await expect
      .poll(() =>
        page
          .locator('[data-testid^="grid-row-"][data-row-key^="group:"][data-row-key*=":row:"]')
          .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-row-key') || '').sort())
      )
      .toEqual(expectedRowKeys.sort());
  }
}

async function createTemporaryGridView(page: Page) {
  const existingViewIds = await DatabaseViewSelectors.viewTab(page).evaluateAll((tabs) =>
    tabs.map((tab) => tab.getAttribute('data-testid') || '')
  );

  await DatabaseViewSelectors.addViewButton(page).click({ force: true });
  await DatabaseViewSelectors.viewTypeOption(page, 'Grid').click({ force: true });
  await expect(DatabaseViewSelectors.viewTab(page)).toHaveCount(existingViewIds.length + 1, { timeout: 20000 });

  const activeTab = DatabaseViewSelectors.activeViewTab(page);

  await expect(activeTab).toBeVisible({ timeout: 20000 });
  const testId = await activeTab.getAttribute('data-testid');
  const viewId = testId?.replace('view-tab-', '') || '';

  if (!viewId || existingViewIds.includes(`view-tab-${viewId}`)) {
    throw new Error(`Expected a newly created active Grid view, received ${String(testId)}`);
  }

  await waitForGridReady(page);
  return viewId;
}

async function deleteDatabaseView(page: Page, viewId: string) {
  const tab = DatabaseViewSelectors.viewTab(page, viewId);

  if ((await tab.count()) === 0) return;

  await tab.click({ button: 'right', force: true });
  await expect(DatabaseViewSelectors.tabActionDelete(page)).toBeVisible({ timeout: 10000 });
  await DatabaseViewSelectors.tabActionDelete(page).click({ force: true });
  await expect(DatabaseViewSelectors.deleteViewConfirmButton(page)).toBeVisible({ timeout: 10000 });
  await DatabaseViewSelectors.deleteViewConfirmButton(page).click({ force: true });
  await expect(tab).toHaveCount(0, { timeout: 20000 });
}

async function deleteCurrentPage(page: Page, pageName: string) {
  await HeaderSelectors.moreActionsButton(page).click({ force: true });
  await expect(ViewActionSelectors.deleteButton(page)).toBeVisible({ timeout: 10000 });
  await ViewActionSelectors.deleteButton(page).click({ force: true });

  const confirmButton = ModalSelectors.confirmDeleteButton(page);

  if (await confirmButton.isVisible().catch(() => false)) {
    await confirmButton.click({ force: true });
  }

  await expect(page.getByTestId('page-title-input').filter({ hasText: pageName })).toHaveCount(0, { timeout: 30000 });
}

async function gridRowIdByTitle(page: Page, title: string) {
  const row = page.locator('[data-testid^="grid-row-"]').filter({ hasText: title }).first();

  await expect(row).toBeVisible({ timeout: 20000 });
  const testId = await row.getAttribute('data-testid');
  const rowId = testId?.replace('grid-row-', '') || '';

  if (!rowId) throw new Error(`Could not resolve the row ID for ${title}`);
  return rowId;
}

async function databaseFieldIdByName(page: Page, fieldName: string) {
  let fieldId = '';

  await expect
    .poll(
      async () => {
        fieldId = await page.evaluate((expectedName) => {
          const database = (window as any).__TEST_DATABASE_CONTEXT__?.databaseDoc?.getMap('data').get('database');
          const fields = database?.get('fields');
          let match = '';

          fields?.forEach((field: any, id: string) => {
            if (field.get('name') === expectedName) match = id;
          });
          return match;
        }, fieldName);
        return fieldId;
      },
      { timeout: 20000, message: `Waiting for the ${fieldName} database field` }
    )
    .not.toBe('');

  return fieldId;
}

async function groupIdByLabel(page: Page, label: string) {
  const header = gridGroupHeaders(page)
    .filter({ has: page.getByText(label, { exact: true }) })
    .first();

  await expect(header).toBeVisible({ timeout: 20000 });
  const groupId = (await header.getAttribute('data-group-id')) || '';

  if (!groupId) throw new Error(`Could not resolve the group ID for ${label}`);
  return groupId;
}

async function switchWorkspace(page: Page, workspaceName: string) {
  const currentWorkspaceName = page.getByTestId('current-workspace-name');

  if ((await currentWorkspaceName.textContent())?.trim() === workspaceName) return;

  await WorkspaceSelectors.dropdownTrigger(page).click();
  await expect(WorkspaceSelectors.dropdownContent(page)).toBeVisible({ timeout: 15000 });
  await WorkspaceSelectors.item(page).filter({ hasText: workspaceName }).first().click();
  await expect(currentWorkspaceName).toHaveText(workspaceName, { timeout: 30000 });
}

type MentionablePerson = {
  person_id: string;
  name?: string;
  email?: string;
  avatar_url?: string;
};

async function getAccessToken(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('token');

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { access_token?: string };

        if (parsed.access_token) return parsed.access_token;
      } catch {
        // Fall through to the test-only token mirror.
      }
    }

    return localStorage.getItem('af_auth_token') || '';
  });
}

async function getMentionablePeople(page: Page, request: APIRequestContext) {
  const workspaceId = new URL(page.url()).pathname.split('/')[2];
  const token = await getAccessToken(page);

  if (!workspaceId || !token) throw new Error('Could not resolve the current workspace session');

  const response = await request.get(`${TestConfig.apiUrl}/api/workspace/${workspaceId}/mentionable-person`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok()) {
    throw new Error(`Mentionable-person request failed with HTTP ${response.status()}`);
  }

  const body = (await response.json()) as { data?: { persons?: MentionablePerson[] } };

  return body.data?.persons ?? [];
}

async function seedPersonGroupingCells(
  page: Page,
  fieldId: string,
  rows: Array<{ rowId: string; people: MentionablePerson[] }>,
  knownPeople: MentionablePerson[]
) {
  await page.evaluate(
    async ({ fieldId, rows, knownPeople, personFieldType }) => {
      const win = window as any;
      const ctx = win.__TEST_DATABASE_CONTEXT__;
      const Y = win.Y;
      const database = ctx.databaseDoc.getMap('data').get('database');
      const databaseId = database.get('id') || ctx.databaseDoc.guid;
      const field = database.get('fields').get(fieldId);
      const typeOptionMap = field.get('type_option');
      let typeOption = typeOptionMap.get(String(personFieldType));

      if (!typeOption) {
        typeOption = new Y.Map();
        typeOptionMap.set(String(personFieldType), typeOption);
      }

      field.set('name', 'Assignee');
      typeOption.set(
        'persons',
        JSON.stringify(
          knownPeople.map((person) => ({
            id: person.person_id,
            name: person.name || person.email || '',
            avatar_url: person.avatar_url || '',
          }))
        )
      );

      for (const assignment of rows) {
        let rowDoc = ctx.rowMap?.[assignment.rowId];

        if (!rowDoc && ctx.ensureRow) rowDoc = await ctx.ensureRow(assignment.rowId);
        if (!rowDoc) rowDoc = await ctx.createRow(`${databaseId}_rows_${assignment.rowId}`);

        rowDoc.transact(() => {
          const now = String(Math.floor(Date.now() / 1000));
          const row = rowDoc.getMap('data').get('data');
          const cells = row.get('cells');
          let cell = cells.get(fieldId);

          if (!cell) {
            cell = new Y.Map();
            cells.set(fieldId, cell);
          }

          cell.set('created_at', cell.get('created_at') || now);
          cell.set('last_modified', now);
          cell.set('field_type', personFieldType);
          cell.set('data', JSON.stringify(assignment.people.map((person) => person.person_id)));
          row.set('last_modified', now);
        });
      }
    },
    { fieldId, rows, knownPeople, personFieldType: FieldType.Person }
  );
}

test.describe('Database identifier grouping', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    setupFieldTypeTest(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('groups EPC-001 into its three rendered Relation groups in an isolated 03_epics view', async ({ page }) => {
    await signInWithPasswordViaUi(page, SEEDED_USER_EMAIL, SEEDED_USER_PASSWORD);
    await switchWorkspace(page, RELATION_WORKSPACE_NAME);
    await expandSpaceByName(page, RELATION_SPACE_NAME);
    await openPageByExactText(page, RELATION_DATABASE_NAME);

    let temporaryViewId = '';

    try {
      temporaryViewId = await createTemporaryGridView(page);
      const relationFieldId = await databaseFieldIdByName(page, 'Tasks');

      if (!relationFieldId) throw new Error('The seeded 03_epics database must contain the Tasks relation field');

      const epicRowId = await gridRowIdByTitle(page, 'EPC-001');

      await groupGridByField(page, relationFieldId);

      const taskGroups = await Promise.all(
        ['TSK-001', 'TSK-002', 'TSK-003'].map(async (label) => ({ label, groupId: await groupIdByLabel(page, label) }))
      );

      await expectRowInExactlyTheseGroups(
        page.getByTestId(`grid-row-${epicRowId}`),
        taskGroups.map(({ groupId }) => groupId)
      );
      await expectFinalGroupedGridDisplay(
        page,
        taskGroups.map(({ groupId, label }) => ({
          groupId,
          label,
          rows: [{ rowId: epicRowId, title: 'EPC-001' }],
        })),
        { exactGroups: false }
      );
    } finally {
      await page.keyboard.press('Escape').catch(() => undefined);
      if (temporaryViewId) await deleteDatabaseView(page, temporaryViewId);
    }
  });

  test('groups rows by the real Annie and Eva members in a temporary Person grid', async ({ page, request }) => {
    await signInWithPasswordViaUi(page, SEEDED_USER_EMAIL, SEEDED_USER_PASSWORD);
    await switchWorkspace(page, PERSON_WORKSPACE_NAME);

    const databaseName = `__bdd_person_group_web__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let databaseCreated = false;

    try {
      const database = await createNamedGridDatabase(page, databaseName, [
        'Shared task',
        'Annie task',
        'Unassigned task',
      ]);

      databaseCreated = true;
      const personFieldId = await addFieldWithType(page, FieldType.Person);
      const people = await getMentionablePeople(page, request);
      const annie = people.find((person) => person.email === 'annie@appflowy.io');
      const eva = people.find((person) => person.email === 'eva@appflowy.io');

      if (!annie || !eva) throw new Error('Nathan workspace must contain the Annie and Eva fixtures');

      await seedPersonGroupingCells(
        page,
        personFieldId,
        [
          { rowId: database.rowIds[0], people: [annie, eva] },
          { rowId: database.rowIds[1], people: [annie] },
        ],
        [annie, eva]
      );

      const annieLabel = annie.name?.trim() || annie.email || '';
      const evaLabel = eva.name?.trim() || eva.email || '';

      await groupGridByField(page, personFieldId);

      await expectRowInExactlyTheseGroups(page.getByTestId(`grid-row-${database.rowIds[0]}`), [
        annie.person_id,
        eva.person_id,
      ]);
      await expectRowInExactlyTheseGroups(page.getByTestId(`grid-row-${database.rowIds[1]}`), [annie.person_id]);
      await expectRowInExactlyTheseGroups(page.getByTestId(`grid-row-${database.rowIds[2]}`), [personFieldId]);
      await expectFinalGroupedGridDisplay(page, [
        {
          groupId: annie.person_id,
          label: annieLabel,
          rows: [
            { rowId: database.rowIds[0], title: 'Shared task' },
            { rowId: database.rowIds[1], title: 'Annie task' },
          ],
        },
        {
          groupId: eva.person_id,
          label: evaLabel,
          rows: [{ rowId: database.rowIds[0], title: 'Shared task' }],
        },
        {
          groupId: personFieldId,
          label: 'No Assignee',
          rows: [{ rowId: database.rowIds[2], title: 'Unassigned task' }],
        },
      ]);
    } finally {
      await page.keyboard.press('Escape').catch(() => undefined);
      await waitForGridReady(page).catch(() => undefined);
      if (databaseCreated) await deleteCurrentPage(page, databaseName);
    }
  });
});
