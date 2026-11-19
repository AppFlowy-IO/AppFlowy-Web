import { expect, test } from '@playwright/test';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { createDatabaseView } from '../../support/database-ui-helpers';
import { getVisibleDataRowIds, openRowDetailByRowId } from '../../support/row-detail-helpers';
import { DatabaseGridSelectors, WorkspaceSelectors } from '../../support/selectors';
import { generateRandomEmail, TestConfig } from '../../support/test-config';

test('row automation availability and a manual notification follow server capabilities', async ({ page, request }) => {
  await signInAndWaitForApp(page, request, generateRandomEmail(), 0);
  await createDatabaseView(page, 'Grid', 0);
  await expect(DatabaseGridSelectors.dataRows(page)).toHaveCount(3);
  const [row] = await getVisibleDataRowIds(page);

  await openRowDetailByRowId(page, row);
  await page.getByTestId('row-detail-more-actions').click();
  await expect(page.getByTestId('row-detail-duplicate')).toBeVisible();
  const setup = page.getByRole('menuitem', { name: 'Automations for this row' });
  const info = await request.get(`${TestConfig.apiUrl}/api/server-info`);

  expect(info.ok()).toBeTruthy();
  const { code, data } = await info.json();

  expect(code).toBe(0);
  const enabled =
    data.enable_database_automations === true && data.database_automation_scope_features?.includes('row_scoped_v1');

  if (process.env.APPFLOWY_TEST_REQUIRE_ROW_AUTOMATIONS === 'true') expect(enabled).toBe(true);
  if (!enabled) {
    await expect(setup).toHaveCount(0);
    return;
  }

  await setup.click();
  const dialog = page.getByRole('dialog', { name: 'Automations for this row' });
  const ruleName = 'Notify me for this row';

  await dialog.getByRole('button', { name: 'New automation' }).click();
  await dialog.getByLabel('Name', { exact: true }).fill(ruleName);
  await dialog.getByLabel('When', { exact: true }).selectOption('manual');
  const save = async () => {
    const [reply] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(`/row/${row}/automation`)
      ),
      dialog.getByRole('button', { name: 'Save', exact: true }).click(),
    ]);

    expect(reply.ok()).toBeTruthy();
    return reply;
  };

  const reply = await save();
  let result = await reply.json();

  // Creating a database also changes its permission topology. A permission change
  // during Save leaves the draft open for another save with the original rule ID.
  if (result.code === -5) {
    await expect
      .poll(
        async () => {
          await expect(dialog.getByRole('alert')).toBeVisible();
          const retry = await save();

          expect(retry.request().postDataJSON()).toEqual(reply.request().postDataJSON());
          result = await retry.json();
          return result.code;
        },
        { timeout: 45_000, intervals: [500, 1_000, 2_000] }
      )
      .not.toBe(-5);
  }

  expect(result).toMatchObject({
    code: 0,
    data: {
      name: ruleName,
      trigger: { type: 'manual' },
      actions: [expect.objectContaining({ type: 'notify', notify_actor: true })],
    },
  });
  const rule = `${TestConfig.apiUrl}${new URL(reply.url()).pathname}/${result.data.id}`;
  const headers = {
    Authorization: `Bearer ${await page.evaluate(() => JSON.parse(localStorage.getItem('token') || '{}').access_token)}`,
  };

  try {
    await expect(dialog.getByRole('button', { name: ruleName })).toBeVisible();
    await dialog.getByRole('button', { name: 'Run now' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Row ID' })).toHaveValue(row);
    await dialog.getByRole('button', { name: 'Run now' }).click();
    await expect(dialog.getByRole('status')).toHaveText('Run queued.');
    await expect
      .poll(
        async () => {
          const history = await request.get(`${rule}/runs`, { headers });
          const receipt = await history.json();

          expect(history.ok()).toBeTruthy();
          expect(receipt.code).toBe(0);
          return receipt.data.items;
        },
        { timeout: 60_000 }
      )
      .toEqual([expect.objectContaining({ row_id: row, status: 'succeeded', notified_count: 1 })]);
    await dialog.getByRole('button', { name: 'Back' }).click();
    await dialog.getByRole('button', { name: 'Run history' }).click();
    await expect(dialog.getByText(/· Succeeded$/)).toBeVisible();
    await expect(dialog.getByText(/Notifications: 1$/)).toBeVisible();
  } finally {
    const removed = await request.delete(rule, { headers, params: { expected_revision: result.data.revision } });

    expect(removed.ok()).toBeTruthy();
    expect((await removed.json()).code).toBe(0);
  }
});

test('workspace owners can turn outgoing webhooks off and restore them after reopening settings', async ({ page, request }) => {
  await signInAndWaitForApp(page, request, generateRandomEmail(), 0);
  const info = await request.get(`${TestConfig.apiUrl}/api/server-info`);

  expect(info.ok()).toBeTruthy();
  const { code, data } = await info.json();

  expect(code).toBe(0);
  const supported = data.enable_database_automations === true &&
    data.database_automation_webhook_features?.includes('workspace_policy_v1') === true;

  if (process.env.APPFLOWY_TEST_REQUIRE_WORKSPACE_WEBHOOK_POLICY === 'true') expect(supported).toBe(true);

  const dialog = page.getByTestId('settings-dialog');
  const openSettings = async () => {
    await expect(async () => {
      if (!(await dialog.isVisible())) {
        await page.keyboard.press('Escape');
        await WorkspaceSelectors.dropdownTrigger(page).click({ timeout: 3_000 });
        await page.getByTestId('settings-button').click({ timeout: 3_000 });
      }

      await dialog.getByTestId('settings-menu-manage_data').click({ timeout: 3_000 });
      await expect(dialog.getByTestId('manage-data-import')).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
  };

  const control = dialog.getByRole('switch', { name: 'Allow outgoing automation webhooks' });

  await openSettings();
  if (!supported) {
    await expect(control).toHaveCount(0);
    return;
  }

  const change = async (disabled: boolean) => {
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.request().method() === 'POST' &&
        /\/api\/workspace\/[^/]+\/settings$/.test(new URL(res.url()).pathname)),
      control.click(),
    ]);

    expect(response.ok()).toBeTruthy();
    expect(response.request().postDataJSON()).toEqual({ disable_automation_webhooks: disabled });
    expect(await response.json()).toMatchObject({ code: 0, data: { disable_automation_webhooks: disabled } });
    await expect(control).toHaveAttribute('aria-checked', String(!disabled));
  };

  await expect(control).toBeEnabled();
  await expect(control).toBeChecked();
  await change(true);
  await page.reload();
  await openSettings();
  await expect(control).toBeEnabled();
  await expect(control).not.toBeChecked();
  await change(false);
});
