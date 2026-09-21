import { expect } from '@playwright/test';

import { fixtureHTML, test } from '../../support/integrations-server';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

test('connected Drive browsing and Calendar reminders lead to private, transcribed notes', async ({
  page,
  integrationsURL,
  context,
}, testInfo) => {
  await context.grantPermissions(['microphone']);
  const event = {
    id: 'planning',
    summary: 'Product planning',
    hangoutLink: 'https://meet.google.com/abc-defg-hij',
    start: { dateTime: new Date(Date.now() + 60_000).toISOString() },
    end: { dateTime: new Date(Date.now() + 60 * 60_000).toISOString() },
    attendees: [{ email: 'alice@example.com', displayName: 'Alice' }],
  };
  const requests: Record<string, unknown>[] = [];
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('https://meet.google.com/**', (route) => route.fulfill({ body: 'Meeting opened' }));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON() as Record<string, unknown> | null;
    let data: unknown = {};

    if (path === '/api/server-info') data = { connections: ['google-drive', 'google-calendar'] };
    else if (path === '/api/integrations/connections')
      data = {
        connections: [
          {
            id: 'drive-personal',
            provider: 'google-drive',
            account_identifier: 'personal@example.com',
            status: 'active',
          },
          { id: 'drive-work', provider: 'google-drive', account_identifier: 'work@example.com', status: 'active' },
          { id: 'calendar', provider: 'google-calendar', account_identifier: 'work@example.com', status: 'active' },
        ],
      };
    else if (path === '/api/integrations/proxy') {
      requests.push(body!);
      const endpoint = body?.endpoint as string;

      if (endpoint.startsWith('/drive/'))
        data = {
          data: {
            files: [
              {
                id: 'file',
                name: body?.connection_id === 'drive-work' ? 'Private roadmap' : 'Personal notes',
                mimeType: 'application/vnd.google-apps.document',
              },
            ],
          },
        };
      else data = { data: endpoint.endsWith('/planning') ? event : { items: [event] } };
    } else if (path.endsWith('/streaming-token')) data = { token: 'test-ephemeral-token', expires_in_seconds: 60 };
    else if (path.endsWith('/update-used-transcribe-duration')) data = { remaining_duration: 3600 };

    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data, message: '' }) });
  });
  await page.routeWebSocket('wss://streaming.assemblyai.com/**', (socket) => {
    socket.send(JSON.stringify({ type: 'Begin', id: 'session' }));
    let receivedAudio = false;

    socket.onMessage((message) => {
      if (typeof message === 'string' && message.includes('Terminate')) {
        socket.send(
          JSON.stringify({
            type: 'Turn',
            turn_order: 1,
            end_of_turn: true,
            transcript: 'Last decision: launch tomorrow.',
          })
        );
        socket.send(JSON.stringify({ type: 'Termination' }));
      } else if (!receivedAudio) {
        receivedAudio = true;
        socket.send(
          JSON.stringify({
            type: 'Turn',
            turn_order: 0,
            end_of_turn: true,
            transcript: 'We agreed to ship the roadmap on Friday.',
          })
        );
        socket.send(JSON.stringify({ type: 'Turn', turn_order: 1, end_of_turn: false, transcript: 'Last decision' }));
      }
    });
  });
  await page.route('**/integrations-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: fixtureHTML('integrations'),
    })
  );
  await page.goto(new URL('/integrations-fixture', integrationsURL).href);
  await expect(page.getByRole('button', { name: 'Personal notes', exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Google Drive account').selectOption('drive-work');
  await page.getByRole('button', { name: 'Private roadmap', exact: true }).click();
  await expect(page.getByTestId('selected-file')).toHaveText('Private roadmap · work@example.com');
  await page.getByLabel('Search files').fill("O'Brien");
  await expect
    .poll(() => requests.some((request) => String((request.params as { q?: string })?.q).includes("O\\'Brien")))
    .toBe(true);
  await expect(page.getByText('Your meeting is starting soon')).toBeVisible();
  const popup = page.waitForEvent('popup');

  await page.getByRole('button', { name: 'Start transcribing', exact: true }).click();
  const meeting = await popup;

  await expect(meeting).toHaveURL(event.hangoutLink);
  await page.bringToFront();
  await expect(page.getByRole('heading', { name: /Product planning/ })).toBeVisible();
  await expect(page.getByTestId('space-permission')).toHaveText('1');
  await expect(page.getByTestId('document-content')).toContainText('Alice (alice@example.com)');
  await page.getByRole('button', { name: 'Microphone only', exact: true }).click();
  await expect(page.getByText('Transcribing…', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('document-content')).toContainText('We agreed to ship the roadmap on Friday.');
  await page.getByRole('button', { name: 'Stop transcribing', exact: true }).click();
  await expect(page.getByText('Transcription saved', { exact: true })).toBeVisible();
  await expect(page.getByTestId('document-content')).toContainText('Last decision: launch tomorrow.');
  const document = JSON.parse((await page.getByTestId('document-content').textContent()) ?? '{}');
  const text = Object.values<string>(document.data.document.meta.text_map);

  expect(text.filter((value) => value.startsWith('Last decision'))).toEqual(['Last decision: launch tomorrow.']);
  await expect(page.getByRole('button', { name: 'Start transcribing', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('connected-features.png'), fullPage: true });
  expect(errors).toEqual([]);
});
