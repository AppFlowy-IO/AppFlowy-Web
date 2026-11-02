import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Element } from 'slate';

import AppTheme from '@/components/main/AppTheme';
import DocumentPresenter from '@/components/presentation/DocumentPresenter';
import { snapshotFromSlate } from '@/components/presentation/snapshot-adapter';
import '@/styles/global.css';

const params = new URLSearchParams(location.search);
const long = params.has('long');
const empty = params.has('empty');
const standalone = params.has('standalone');
const block = (id: string, type: string, text: string, data = {}, children: Element[] = []): Element =>
  ({ blockId: id, type, data, children: [{ type: 'text', children: [{ text }] }, ...children] } as Element);
const items = Array.from({ length: long ? 14 : 3 }, (_, index) =>
  block(`item-${index}`, 'numbered_list', `Action ${index + 1}: keep this item together.`, {}, [
    block(`detail-${index}`, 'paragraph', `Detail ${index + 1}: the owner and due date stay with their action.`),
  ])
);
const summary = [
  block('overview', 'heading', 'Meeting decisions', { level: 2 }),
  block('intro', 'paragraph', 'Context before the action list. '.repeat(standalone ? 23 : 14)),
  ...items,
];
const meeting = block('meeting', 'ai_meeting', '', { title: 'Weekly product sync', selected_tab_index: 2 }, [
  block('summary', 'ai_meeting_summary', '', {}, empty ? [] : summary),
  block('notes', 'ai_meeting_notes', '', {}, [block('notes-heading', 'heading', 'PRIVATE NOTES', { level: 2 })]),
  block('transcript', 'ai_meeting_transcription', '', {}, [
    block('transcript-heading', 'heading', 'TRANSCRIPT HEADING', { level: 2 }),
    ...Array.from({ length: 50 }, (_, index) =>
      block(`speech-${index}`, 'ai_meeting_speaker', `TRANSCRIPT ONLY ${index}`)
    ),
  ]),
]);
const source = {
  type: 'page',
  children: [
    block('toc', 'outline', '', { depth: 2 }),
    block('divider', 'divider', ''),
    ...(standalone ? summary : [meeting]),
    block('finish-divider', 'divider', ''),
    block('finished', 'paragraph', 'After the meeting.'),
  ],
} as Element;
const before = JSON.stringify(source);
const snapshot = snapshotFromSlate('meeting-page', 'Meeting presentation', source);
const snapshotBefore = JSON.stringify(snapshot);
function Fixture() {
  const [open, setOpen] = useState(false);
  return (
    <AppTheme>
      <button onClick={() => setOpen(true)}>Present document</button>
      {open && (
        <DocumentPresenter
          snapshot={snapshot}
          onSource={() => setOpen(false)}
          onClose={() => {
            setOpen(false);
            document.documentElement.dataset.unchanged = String(
              before === JSON.stringify(source) && snapshotBefore === JSON.stringify(snapshot)
            );
          }}
        />
      )}
    </AppTheme>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
