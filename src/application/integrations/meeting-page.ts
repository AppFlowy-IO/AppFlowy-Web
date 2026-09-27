import { CalendarEvent } from '@/application/integrations/google-calendar';
import { BlockType, CreatePagePayload, SpacePermission, ViewLayout } from '@/application/types';
import { AppOperationsContextType } from '@/components/app/contexts/AppOperationsContext';

export function calendarMeetingPage(event: CalendarEvent, title: string, attendeesLabel: string): CreatePagePayload {
  const paragraph = (text = '') => ({ type: BlockType.Paragraph, data: { delta: [{ insert: text }] }, children: [] });

  return {
    layout: ViewLayout.Document,
    name: title,
    page_data: {
      type: 'page',
      children: [
        {
          type: BlockType.AIMeetingBlock,
          data: {
            title,
            date: new Date(event.start).toISOString(),
            recording_state: 'idle',
            created_at: new Date().toISOString(),
            show_notes_directly: false,
            meeting_source: 'google_calendar',
            meeting_app_name: 'Google Meet',
            scheduled_start_time: new Date(event.start).toISOString(),
            ...(event.end ? { scheduled_end_time: new Date(event.end).toISOString() } : {}),
          },
          children: [
            { type: BlockType.AIMeetingSummaryBlock, children: [paragraph()] },
            {
              type: BlockType.AIMeetingNotesBlock,
              children: [
                ...(event.attendees.length
                  ? [
                      paragraph(attendeesLabel),
                      ...event.attendees.map((person) =>
                        paragraph(person.displayName ? `${person.displayName} (${person.email})` : person.email)
                      ),
                    ]
                  : []),
                paragraph(),
              ],
            },
            { type: BlockType.AIMeetingTranscriptionBlock, children: [paragraph()] },
          ],
        },
      ],
    },
  };
}

export async function createCalendarMeetingPage(
  operations: Pick<AppOperationsContextType, 'addPage' | 'createSpaceWithInitialPage'>,
  privateSpaceId: string | undefined,
  page: CreatePagePayload,
  spaceName: string
) {
  if (privateSpaceId && operations.addPage) return operations.addPage(privateSpaceId, page);
  if (!operations.createSpaceWithInitialPage) throw new Error('Meeting page creation is unavailable');
  // Never place meeting attendees or transcripts in a shared space by default.
  const result = await operations.createSpaceWithInitialPage({
    name: spaceName,
    space_permission: SpacePermission.Private,
    initial_page: page,
  });

  return result.page;
}
