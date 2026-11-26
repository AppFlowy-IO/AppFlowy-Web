import { expect, Page } from '@playwright/test';

import { fixtureHTML, test } from '../../support/integrations-server';
import { mockServerInfo } from '../../support/server-info-helpers';

// Flutter's MeetingPageCreator and `/AI Meeting Notes` set `show_notes_directly: true` and never
// clear it, so a meeting recorded on desktop still carries the flag next to its summary and
// transcript. The flag only replaces the welcome screen; it must not hide those sections.
// `selected_tab_index` is a position in Flutter's tabs, so both apps must resolve it to one tab.
const path = '/app/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002';
const summaryText = 'Decision: ship search on Friday.';
const transcriptText = 'We will ship search on Friday.';
const attendeeText = 'Speaker A (speaker-a@example.com)';

const paragraph = (text = '') => ({ type: 'paragraph', data: {}, children: [{ type: 'text', children: [{ text }] }] });
// The fixture seeds a lone text child as a section without child blocks, as Flutter creates them.
const withoutChildBlocks = [{ type: 'text', children: [{ text: '' }] }];

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
      { type: 'ai_meeting_summary', data: {}, children: summary ? [paragraph(summary)] : withoutChildBlocks },
      { type: 'ai_meeting_notes', data: {}, children: notes.map(paragraph) },
      {
        type: 'ai_meeting_transcription',
        data: {},
        children: transcript
          ? [{ type: 'ai_meeting_speaker', data: { speaker_id: 'A', timestamp: 0 }, children: [paragraph(transcript)] }]
          : withoutChildBlocks,
      },
    ],
  };
}

type SavedNode = { type?: string; blockId?: string; data?: Record<string, unknown>; children?: SavedNode[] };

const editor = (page: Page) => page.getByTestId('editor-content');
const snapshot = (page: Page) => page.getByTestId('code-document-snapshot');
const meeting = (page: Page) => page.locator('.ai-meeting-block');
const tab = (page: Page, name: 'Summary' | 'Notes' | 'Transcript') =>
  meeting(page).locator('.ai-meeting-tabs').getByRole('button', { name, exact: true });

async function waitForEditor(page: Page) {
  await expect(snapshot(page)).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect(meeting(page)).toBeVisible();
}

async function openMeeting(page: Page, integrationsURL: string, seed?: object) {
  const query = seed ? `&seed=${encodeURIComponent(JSON.stringify(seed))}` : '';

  await page.goto(`${integrationsURL}${path}?server-info${query}`, { waitUntil: 'commit' });
  await expect(snapshot(page)).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
}

async function savedMeeting(page: Page) {
  const nodes = JSON.parse((await snapshot(page).textContent()) || '[]') as SavedNode[];

  return nodes.find((node) => node.type === 'ai_meeting');
}

async function savedMeetingData(page: Page) {
  return (await savedMeeting(page))?.data;
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/workspace/*/usage-and-limit', (route) => route.fulfill({ json: { code: 0, data: {} } }));
  // Summary options fall back to the built-in templates without a configured server.
  await page.route('**/api/meeting/summary_templates', (route) => route.fulfill({ json: { code: 0, data: null } }));
  await page.route(`**${path}?server-info*`, (route) =>
    route.fulfill({ contentType: 'text/html', body: fixtureHTML('code-block') })
  );
  await mockServerInfo(page, { ai_enabled: true, enable_meeting: true });
});

test('a meeting recorded on desktop keeps its summary and transcript reachable', async ({ page, integrationsURL }) => {
  await openMeeting(page, integrationsURL, desktopMeeting({ summary: summaryText, transcript: transcriptText }));
  await waitForEditor(page);

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
  await waitForEditor(page);
  await page.getByLabel('Read only').check();

  await expect(meeting(page)).toHaveAttribute('data-ai-meeting-active', 'summary');
  await expect(editor(page).getByText(summaryText)).toBeVisible();
  await tab(page, 'Transcript').click();
  await expect(editor(page).getByText(transcriptText)).toBeVisible();
  await expect(editor(page).getByText(summaryText)).toBeHidden();
});

const firstRenderCases = [
  { name: 'a notes-first desktop meeting', seed: desktopMeeting({ notes: ['Attendees:', attendeeText, ''] }), tab: 'notes' },
  {
    name: 'a meeting saved on its Transcript tab',
    seed: {
      ...desktopMeeting({ summary: summaryText, transcript: transcriptText }),
      data: { title: 'Weekly sync', selected_tab_index: 2, recording_state: 'recorded' },
    },
    tab: 'transcript',
  },
];

for (const { name, seed, tab: expectedTab } of firstRenderCases) {
  test(`${name} never paints another tab first`, async ({ page, integrationsURL }) => {
    // Record each painted change of the active tab, from the block's first insertion.
    await page.addInitScript(() => {
      const seen: string[] = [];

      Object.assign(window, { activeMeetingTabs: seen });
      new MutationObserver(() => {
        const active = document.querySelector('.ai-meeting-block')?.getAttribute('data-ai-meeting-active');

        if (active && seen[seen.length - 1] !== active) seen.push(active);
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-ai-meeting-active'] });
    });
    await openMeeting(page, integrationsURL, seed);
    await waitForEditor(page);

    await expect(meeting(page)).toHaveAttribute('data-ai-meeting-active', expectedTab);
    expect(await page.evaluate(() => (window as unknown as { activeMeetingTabs: string[] }).activeMeetingTabs)).toEqual([
      expectedTab,
    ]);
  });
}

test('a notes-first desktop meeting opens on Notes until it has a summary', async ({ page, integrationsURL }) => {
  await openMeeting(page, integrationsURL, desktopMeeting({ notes: ['Attendees:', attendeeText, ''] }));
  await waitForEditor(page);

  await expect(meeting(page)).toHaveAttribute('data-ai-meeting-active', 'notes');
  await expect(editor(page).getByText(attendeeText)).toBeVisible();

  // The Summary tab still offers generating the first summary.
  await tab(page, 'Summary').click();
  await expect(meeting(page)).toHaveAttribute('data-ai-meeting-active', 'summary');
  await expect(editor(page).getByText(attendeeText)).toBeHidden();
});

test('tab choices before the first summary use the same positions as desktop', async ({ page, integrationsURL }) => {
  // Without a summary, Flutter's tabs are Notes and Transcript, so its saved index 1 is Transcript.
  const unsummarized = desktopMeeting({ notes: ['Agenda: search launch'], transcript: transcriptText });

  await openMeeting(page, integrationsURL, { ...unsummarized, data: { ...unsummarized.data, selected_tab_index: 1 } });
  await waitForEditor(page);
  await expect(meeting(page)).toHaveAttribute('data-ai-meeting-active', 'transcript');
  await expect(editor(page).getByText(transcriptText)).toBeVisible();

  // Flutter has no tab for generating a first summary, so choosing it changes nothing saved.
  await tab(page, 'Summary').click();
  await expect(meeting(page)).toHaveAttribute('data-ai-meeting-active', 'summary');
  expect(await savedMeetingData(page)).toMatchObject({ selected_tab_index: 1 });

  await tab(page, 'Notes').click();
  await expect(meeting(page)).toHaveAttribute('data-ai-meeting-active', 'notes');
  await expect.poll(() => savedMeetingData(page)).toMatchObject({ show_notes_directly: true, selected_tab_index: 0 });
});

test('a meeting inserted on Web starts with the same sections as desktop', async ({ page, integrationsURL }) => {
  await openMeeting(page, integrationsURL);
  await editor(page).locator('.text-element').last().click();
  await page.keyboard.type('/transcript');
  await page.getByTestId('slash-menu-aiTranscript').click();
  await expect(meeting(page)).toBeVisible();

  // Flutter's aiMeetingNode(): Summary and Transcript start without child blocks; Notes has one paragraph.
  await expect
    .poll(async () =>
      (await savedMeeting(page))?.children?.map((section) => [
        section.type,
        section.children?.filter((child) => child.blockId).length,
      ])
    )
    .toEqual([
      ['ai_meeting_summary', 0],
      ['ai_meeting_notes', 1],
      ['ai_meeting_transcription', 0],
    ]);
});
