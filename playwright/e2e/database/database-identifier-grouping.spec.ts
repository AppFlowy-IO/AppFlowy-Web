/**
 * Relation and Person grouping coverage for multi-value identifier fields.
 *
 * Both scenarios create isolated databases. The Person fixture uses the real
 * member IDs in Nathan's seeded workspace and deletes its temporary database;
 * the Relation fixture runs in a fresh test account. Number grouping remains
 * covered by database-grid-grouping.spec.ts.
 */
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { signInAndWaitForApp, signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { waitForGridReady } from '../../support/database-ui-helpers';
import { deletePageByExactText } from '../../support/duplicate-test-helpers';
import { addFieldWithType, setupFieldTypeTest } from '../../support/field-type-helpers';
import {
  createNamedGridDatabase,
  createOneWayRelationField,
  setRelationCellDirect,
} from '../../support/relation-test-helpers';
import { FieldType, WorkspaceSelectors } from '../../support/selectors';
import { generateRandomEmail, setupPageErrorHandling, TestConfig } from '../../support/test-config';

const SEEDED_USER_EMAIL = process.env.SEEDED_USER_EMAIL || 'nathan@appflowy.io';
const SEEDED_USER_PASSWORD = process.env.SEEDED_USER_PASSWORD || 'AppFlowy!@123';
const PERSON_WORKSPACE_NAME = 'nathan workspace';

const gridGroupHeaders = (page: Page) => page.locator('[data-testid^="grid-group-header-"]');
const groupHeaderByLabel = (page: Page, label: string) =>
  gridGroupHeaders(page).filter({
    has: page.getByText(label, { exact: true }),
  });

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

  test('groups one source row into exactly three Relation groups using related row titles', async ({
    page,
    request,
  }) => {
    await signInAndWaitForApp(page, request, generateRandomEmail());

    const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const target = await createNamedGridDatabase(page, `Relation targets ${runId}`, ['TSK-001', 'TSK-002', 'TSK-003']);
    const source = await createNamedGridDatabase(page, `Relation sources ${runId}`, ['EPC-001', 'EPC-002', 'EPC-003']);
    const relationFieldId = await createOneWayRelationField(page, {
      fieldName: 'Tasks',
      relatedDatabaseId: target.databaseId,
    });

    await setRelationCellDirect(page, relationFieldId, 0, target.rowIds.slice(0, 3));
    await groupGridByField(page, relationFieldId);

    for (const title of ['TSK-001', 'TSK-002', 'TSK-003']) {
      await expect(groupHeaderByLabel(page, title)).toBeVisible({ timeout: 30000 });
    }

    await expectRowInExactlyTheseGroups(page.getByTestId(`grid-row-${source.rowIds[0]}`), target.rowIds.slice(0, 3));
    await expect(
      page.getByTestId(`grid-group-header-${relationFieldId}`).getByTestId('grid-group-row-count')
    ).toHaveText('2');
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

      await expect(groupHeaderByLabel(page, annieLabel)).toBeVisible({ timeout: 30000 });
      await expect(groupHeaderByLabel(page, evaLabel)).toBeVisible({ timeout: 30000 });
      await expectRowInExactlyTheseGroups(page.getByTestId(`grid-row-${database.rowIds[0]}`), [
        annie.person_id,
        eva.person_id,
      ]);
      await expectRowInExactlyTheseGroups(page.getByTestId(`grid-row-${database.rowIds[1]}`), [annie.person_id]);
      await expect(
        page.getByTestId(`grid-group-header-${personFieldId}`).getByTestId('grid-group-row-count')
      ).toHaveText('1');
    } finally {
      await page.keyboard.press('Escape').catch(() => undefined);
      await waitForGridReady(page).catch(() => undefined);
      if (databaseCreated) await deletePageByExactText(page, databaseName);
    }
  });
});
