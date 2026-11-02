import type { Element } from 'slate';

import { presentationSections, meetingMeasureKey } from '../document-content';
import { documentOutline } from '../document-outline';
import { paginateDocument } from '../document-pagination';
import { snapshotFromSlate } from '../snapshot-adapter';
import type { SourceBlock } from '../types';

beforeAll(() => {
  global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
});

const item = (id: string, type = 'numbered_list'): SourceBlock => ({
  id,
  type,
  text: id,
  listMarker: `${id}.`,
  children: [],
});

it('keeps a complete numbered list on one slide when the remaining space is too small', () => {
  const blocks = [item('intro', 'paragraph'), item('1'), item('2'), item('3'), item('after', 'paragraph')];
  const pages = paginateDocument(
    [{ title: '', blocks }],
    { '0:0': 160, '0:1': 70, '0:2': 70, '0:3': 70, '0:4': 100 },
    300
  );
  expect(pages.map((page) => page.blocks.map((block) => block.id))).toEqual([['intro'], ['1', '2', '3'], ['after']]);
});

it('keeps a heading and a short list together and splits long lists between complete items', () => {
  const heading = { ...item('Heading', 'heading'), level: 2 };
  const blocks = [heading, item('1'), item('2'), item('3'), item('4')];
  const heights = { '0:0': 40, '0:1': 80, '0:2': 80, '0:3': 80, '0:4': 80 };
  expect(paginateDocument([{ title: '', blocks }], heights, 400)).toHaveLength(1);
  const pages = paginateDocument([{ title: '', blocks }], heights, 300);
  expect(pages.map((page) => page.blocks.map((block) => block.id))).toEqual([['Heading', '1', '2', '3'], ['4']]);
  expect(pages.every((page) => page.partCount === 1 && page.scrollTop === 0)).toBe(true);
  expect(
    pages
      .flatMap((page) => page.blocks.filter((block) => block.type === 'numbered_list'))
      .map((block) => block.listMarker)
  ).toEqual(['1.', '2.', '3.', '4.']);
});

it('presents only summary children while retaining the original transcript and selected tab in the source', () => {
  const heading = (id: string) => ({
    blockId: id,
    type: 'heading',
    data: { level: 2 },
    children: [{ type: 'text', children: [{ text: id }] }],
  });
  const source = {
    type: 'page',
    children: [
      {
        blockId: 'meeting',
        type: 'ai_meeting',
        data: { title: 'Weekly sync', selected_tab_index: 2 },
        children: [
          { blockId: 'summary', type: 'ai_meeting_summary', children: [heading('Summary heading')] },
          { blockId: 'notes', type: 'ai_meeting_notes', children: [heading('Private notes')] },
          { blockId: 'transcript', type: 'ai_meeting_transcription', children: [heading('Transcript heading')] },
        ],
      },
    ],
  } as Element;
  const before = JSON.stringify(source);
  const snapshot = snapshotFromSlate('page', 'Meeting page', source);
  const sections = presentationSections(snapshot);
  expect(sections[1].meeting?.meeting?.title).toBe('Weekly sync');
  expect(sections[1].blocks.map((block) => block.id)).toEqual(['Summary heading']);
  expect(documentOutline(sections).headings.map((heading) => heading.data.text)).toEqual(['Summary heading']);
  expect(snapshot.blocks[0].children.map((block) => block.type)).toEqual([
    'ai_meeting_summary',
    'ai_meeting_notes',
    'ai_meeting_transcription',
  ]);
  expect(JSON.stringify(source)).toBe(before);
});

it('reserves meeting frame space when keeping its numbered list together', () => {
  const meeting = { ...item('meeting', 'ai_meeting'), children: [] };
  const blocks = [item('intro', 'paragraph'), item('1'), item('2'), item('3')];
  const pages = paginateDocument(
    [{ title: '', blocks, meeting }],
    { [meetingMeasureKey(0)]: 100, '0:0': 120, '0:1': 60, '0:2': 60, '0:3': 60 },
    300
  );
  expect(pages.map((page) => page.blocks.map((block) => block.id))).toEqual([['intro'], ['1', '2', '3']]);
  expect(pages.every((page) => page.meeting === meeting && page.frameHeight === 100)).toBe(true);
});
