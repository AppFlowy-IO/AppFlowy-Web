import { expect } from '@playwright/test';

import { fixtureHTML, test } from '../../support/integrations-server';
import { mockServerInfo } from '../../support/server-info-helpers';

const path = '/app/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002';
const unavailable = 'Meeting transcription is unavailable. Contact your workspace administrator to enable AssemblyAI.';

for (const enabled of [false, undefined, true]) {
  test(`AI Transcript follows enable_meeting=${enabled}`, async ({ page, integrationsURL }) => {
    const server = await mockServerInfo(page, { ai_enabled: true, enable_meeting: enabled });
    await page.route('**/api/workspace/*/usage-and-limit', (route) =>
      route.fulfill({ json: { code: 0, data: {} } })
    );
    await page.route(`**${path}?server-info`, (route) =>
      route.fulfill({ contentType: 'text/html', body: fixtureHTML('code-block') })
    );
    await page.goto(`${integrationsURL}${path}?server-info`, { waitUntil: 'commit' });
    await expect(page.getByTestId('code-document-snapshot')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await page.getByTestId('editor-content').locator('.text-element').last().click();
    await page.keyboard.type('/transcript');

    const option = page.getByTestId('slash-menu-aiTranscript');
    const block = page.locator('.ai-meeting-block');

    if (enabled) {
      await expect(option).toBeEnabled();
      await page.keyboard.press('Enter');
      const upload = block.getByRole('button', { name: 'Transcribe audio file' });
      await expect(upload).toBeEnabled();
      await block.getByRole('textbox').fill('Saved meeting');
      await block.getByRole('textbox').press('Enter');
      server.setServerInfo({ enable_meeting: false });
      await page.reload({ waitUntil: 'commit' });
      await expect(block.getByRole('textbox')).toHaveValue('Saved meeting');
      await expect(upload).toBeDisabled();
      await upload.hover({ force: true });
      await expect(page.getByRole('tooltip')).toHaveText(unavailable);
    } else {
      await expect(option).toBeDisabled();
      await option.hover();
      await expect(page.getByRole('tooltip')).toHaveText(unavailable);
      await option.click({ force: true });
      await page.keyboard.press('Enter');
      await expect(option).toBeVisible();
      await expect(block).toHaveCount(0);
    }
  });
}
