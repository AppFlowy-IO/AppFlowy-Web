import { BlockType, SpacePermission, ViewLayout } from '@/application/types';

import { calendarMeetingPage, createCalendarMeetingPage } from '../meeting-page';

const event = {
  id: 'event',
  workspaceId: 'workspace',
  connectionId: 'account',
  summary: 'Planning',
  start: Date.parse('2026-09-21T08:00:00Z'),
  end: Date.parse('2026-09-21T09:00:00Z'),
  meetUrl: 'https://meet.google.com/abc-defg-hij',
  attendees: [{ email: 'a@example.com', displayName: 'Alice' }],
};

it('creates the same native meeting sections, scheduling metadata and attendee notes', () => {
  const payload = calendarMeetingPage(event, 'Planning - 08:00', 'Attendees:');

  expect(payload).toMatchObject({
    layout: ViewLayout.Document,
    name: 'Planning - 08:00',
    page_data: {
      children: [
        {
          type: BlockType.AIMeetingBlock,
          data: {
            meeting_source: 'google_calendar',
            scheduled_start_time: '2026-09-21T08:00:00.000Z',
            scheduled_end_time: '2026-09-21T09:00:00.000Z',
          },
          children: [
            { type: BlockType.AIMeetingSummaryBlock },
            {
              type: BlockType.AIMeetingNotesBlock,
              children: [
                expect.anything(),
                { data: { delta: [{ insert: 'Alice (a@example.com)' }] } },
                expect.anything(),
              ],
            },
            { type: BlockType.AIMeetingTranscriptionBlock },
          ],
        },
      ],
    },
  });
  expect(JSON.stringify(payload)).not.toContain('auto_start_recording');
});

it('creates a private space when no private parent exists', async () => {
  const addPage = jest.fn();
  const createSpaceWithInitialPage = jest.fn().mockResolvedValue({ page: { view_id: 'new-page' } });
  const page = calendarMeetingPage(event, 'Planning', 'Attendees:');

  await expect(
    createCalendarMeetingPage({ addPage, createSpaceWithInitialPage }, undefined, page, 'Meeting')
  ).resolves.toEqual({ view_id: 'new-page' });
  expect(addPage).not.toHaveBeenCalled();
  expect(createSpaceWithInitialPage).toHaveBeenCalledWith({
    name: 'Meeting',
    space_permission: SpacePermission.Private,
    initial_page: page,
  });
});
