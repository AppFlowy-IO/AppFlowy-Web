import { expect, Page } from '@playwright/test';

import { fixtureHTML, test } from '../../support/integrations-server';
import { mockServerInfo } from '../../support/server-info-helpers';

// Flutter's MeetingPageCreator and `/AI Meeting Notes` set `show_notes_directly: true` and never
// clear it, so a meeting recorded on desktop still carries the flag next to its summary and
// transcript. The flag only replaces the welcome screen; it must not hide those sections.
const path = '/app/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002';
const summaryText = 'Decision: ship search on Friday.';
const transcriptText = 'We will ship search on Friday.';
const attendeeText = 'Speaker A (speaker-a@example.com)';

const paragraph = (text = '') => ({ type: 'paragraph', data: {}, children: [{ type: 'text', children: [{ text }] }] });

function desktopMeeting({ summary, notes = [''], transcript }: { summary?: string; notes?: string[]; transcript?: string }) {
  return {
    type: 'ai_meeting',
    data: {
      title: 'Weekly sync',
      show_notes_directly: true,
      selected_tab_index: 0,
      recording_state: transcript ? 'recorded' : 'idle',
    },
    children: [
      { type: 'ai_meeting_summary', data: {}, children: [paragraph(summary)] },
      { type: 'ai_meeting_notes', data: {}, children: notes.map(paragraph) },
      {
        type: 'ai_meeting_transcription',
        data: {},
        children: transcript
          ? [{ type: 'ai_meeting_speaker', data: { speaker_id: 'A', timestamp: 0 }, children: [paragraph(transcript)] }]
          : [paragraph()],
      },
    ],
  };
}

const editor = (page: Page) => page.getByTestId('editor-content');
const snapshot = (page: Page) => page.getByTestId('code-document-snapshot');
const meeting = (page: Page) => page.locator('.ai-meeting-block');
const tab = (page: Page, name: 'Summary' | 'Notes' | 'Transcript') =>
  meeting(page).locator('.ai-meeting-tabs').getByRole('button', { name, exact: true });

async function waitForEditor(page: Page) {
  await expect(snapshot(page)).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect(meeting(page)).toBeVisible();
}

async function openMeeting(page: Page, integrationsURL: string, seed: ReturnType<typeof desktopMeeting>) {
  await page.goto(`${integrationsURL}${path}?server-info&seed=${encodeURIComponent(JSON.stringify(seed))}`, {
    waitUntil: 'commit',
  });
  await waitForEditor(page);
}

async function savedMeetingData(page: Page) {
  const nodes = JSON.parse((await snapshot(page).textContent()) || '[]') as { type: string; data?: object }[];

  return nodes.find((node) => node.type === 'ai_meeting')?.data;
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/workspace/*/usage-and-limit', (route) => route.fulfill({ json: { code: 0, data: {} } }));
  await page.route(`**${path}?server-info*`, (route) =>
    route.fulfill({ contentType: 'text/html', body: fixtureHTML('code-block') })
  );
  await mockServerInfo(page, { ai_enabled: true, enable_meeting: true });
});

test('a meeting recorded on desktop keeps its summary and transcript reachable', async ({ page, integrationsURL }) => {
  await openMeeting(page, integrationsURL, desktopMeeting({ summary: summaryText, transcript: transcriptText }));

  await expect(meeting(page)).toHaveAttribute('data-ai-meeting-active', 'summary');
  await expect(editor(page).getByText(summaryText)).toBeVisible();
  await expect(tab(page, 'Notes')).toBeVisible();

  await tab(page, 'Transcript').click();
  await expect(meeting(page)).toHaveAttribute('data-ai-meeting-active', 'transcript');
  await expect(editor(page).getByText(transcriptText)).toBeVisible();
  await expect(editor(page).getByText(summaryText)).toBeHidden();
  await expect.poll(() => savedMeetingData(page)).toMatchObject({ show_notes_directly: true, selected_tab_index: 2 });

  // The tab choice is saved in the document, and the desktop flag no longer hides it.
  await page.reload({ waitUntil: 'commit' });
  await waitForEditor(page);
  await expect(meeting(page)).toHaveAttribute('data-ai-meeting-active', 'transcript');
  await expect(editor(page).getByText(transcriptText)).toBeVisible();
});

test('read-only viewers can open each section of a desktop meeting', async ({ page, integrationsURL }) => {
  await openMeeting(page, integrationsURL, desktopMeeting({ summary: summaryText, transcript: transcriptText }));
  await page.getByLabel('Read only').check();

  await expect(meeting(page)).toHaveAttribute('data-ai-meeting-active', 'summary');
  await expect(editor(page).getByText(summaryText)).toBeVisible();
  await tab(page, 'Transcript').click();
  await expect(editor(page).getByText(transcriptText)).toBeVisible();
  await expect(editor(page).getByText(summaryText)).toBeHidden();
});

test('a notes-first desktop meeting opens on Notes until it has a summary', async ({ page, integrationsURL }) => {
  await openMeeting(page, integrationsURL, desktopMeeting({ notes: ['Attendees:', attendeeText, ''] }));

  await expect(meeting(page)).toHaveAttribute('data-ai-meeting-active', 'notes');
  await expect(editor(page).getByText(attendeeText)).toBeVisible();

  // The Summary tab still offers generating the first summary.
  await tab(page, 'Summary').click();
  await expect(meeting(page)).toHaveAttribute('data-ai-meeting-active', 'summary');
  await expect(editor(page).getByText(attendeeText)).toBeHidden();
});
