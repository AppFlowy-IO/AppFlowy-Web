import { expect, type Page } from '@playwright/test';

import { RevertedDialogSelectors } from './selectors';

/** Require acknowledgement after each completed database restore, including peer restores. */
export async function acknowledgeDatabaseRestore(page: Page): Promise<void> {
  const dialog = RevertedDialogSelectors.dialog(page);

  await expect(dialog).toBeVisible({ timeout: 90000 });
  await expect(dialog.getByRole('heading', { name: 'Database restored', exact: true })).toBeVisible();
  await expect(
    dialog.getByText(
      'This database was restored to a previous version. You can continue editing the restored version.',
      { exact: true }
    )
  ).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Got it', exact: true });

  await expect(confirm).toBeEnabled();
  await expect(confirm).toBeFocused();
  await confirm.click();
  await expect(dialog).toBeHidden();
}
