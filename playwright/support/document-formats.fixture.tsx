import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { type Element, type Text } from 'slate';

import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { createEmptyDocument, getPageId } from '@/application/slate-yjs/utils/yjs';
import {
  MentionType,
  ViewIconType,
  ViewLayout,
  YjsEditorKey,
  type View,
  type YSharedRoot,
  type YDoc,
} from '@/application/types';
import { AppOperationsContext, type AppOperationsContextType } from '@/components/app/contexts/AppOperationsContext';
import { AFConfigContext } from '@/components/main/app.hooks';
import AppTheme from '@/components/main/AppTheme';
import { Editor } from '@/components/editor/Editor';
import { calloutPresetData, QUICK_STYLE_OPTIONS } from '@/components/editor/components/blocks/callout/callout.utils';
import DocumentPresenter from '@/components/presentation/DocumentPresenter';
import { snapshotFromSlate } from '@/components/presentation/snapshot-adapter';
import { TooltipProvider } from '@/components/ui/tooltip';
import '@/styles/global.css';

function block(id: string, type: string, runs: string | Text[], data = {}, children: Element[] = []): Element {
  return {
    blockId: id,
    type,
    data,
    children: [
      { type: 'text', textId: `text-${id}`, children: typeof runs === 'string' ? [{ text: runs }] : runs },
      ...children,
    ],
  } as Element;
}
const pageMention = (id: string) => ({ text: '$', mention: { type: MentionType.PageRef, page_id: id } });
const blocks = [
  block('welcome', 'heading', 'Welcome to AppFlowy', { level: 2 }),
  block('desktop', 'heading', [pageMention('desktop-guide')], { level: 3 }),
  block('mobile', 'heading', [pageMention('mobile-guide')], { level: 3 }),
  block(
    'todos',
    'heading',
    [pageMention('todos'), { text: ' quick start', font_color: 'text-color-1', bg_color: 'bg-color-10' }],
    { level: 3 }
  ),
  block('child', 'sub_page', '', { view_id: 'web-guide' }),
  block('linked', 'linked_page', '', { view_id: 'desktop-guide' }),
  block('mark-divider', 'divider', ''),
  block('marks', 'heading', 'Document formatting', { level: 2 }),
  block('formatted', 'paragraph', [
    { text: 'Bold', bold: true },
    { text: ' and ' },
    { text: 'italic', italic: true },
    { text: ', ' },
    { text: 'underlined', underline: true },
    { text: ', ' },
    { text: 'struck', strikethrough: true },
    { text: ', ' },
    { text: 'inline code', code: true },
    { text: '. ' },
    { text: 'Visit AppFlowy', href: 'https://appflowy.com', font_color: '#b62424' },
  ]),
  block('inline-objects', 'paragraph', [
    { text: '$', mention: { type: MentionType.Person, person_id: 'person-1', person_name: 'Alex' } },
    { text: ' · ' },
    { text: '$', mention: { type: MentionType.Date, date: '2026-10-22T12:00:00.000Z' } },
    { text: ' · ' },
    { text: '$', formula: 'x^2' },
  ]),
  block('number-1', 'numbered_list', 'First numbered item'),
  block('number-2', 'numbered_list', 'Second numbered item'),
  block('done', 'todo_list', 'Completed task', { checked: true }),
  block('quote', 'quote', 'A native AppFlowy quote.'),
  block('callout-divider', 'divider', ''),
  block('callout-title', 'heading', 'Callouts', { level: 2 }),
  block(
    'info',
    'callout',
    [{ text: 'Information: ', bold: true }, { text: 'read the ' }, pageMention('desktop-guide')],
    calloutPresetData(QUICK_STYLE_OPTIONS[1]),
    [block('nested', 'paragraph', 'Nested content keeps the callout indentation.')]
  ),
  block('warning', 'callout', 'A warning with its original emoji.', {
    ...calloutPresetData(QUICK_STYLE_OPTIONS[3]),
    icon_type: 'emoji',
    icon: '⚠️',
  }),
  block('no-icon', 'callout', 'An intentionally removed icon.', {
    version: 1,
    icon: '',
    bgColor: 'appflowy_them_color_tint13',
  }),
  block('legacy', 'callout', 'A legacy callout keeps its original emoji.', { icon: '💡' }),
];
const snapshot = snapshotFromSlate('format-source', 'Getting started', { type: 'page', children: blocks } as Element);
const original = JSON.stringify(snapshot);
const names: Record<string, string> = {
  'desktop-guide': 'Desktop guide',
  'mobile-guide': 'Mobile guide',
  'web-guide': 'Web guide',
  todos: 'To-dos',
};
const icons: Record<string, string> = { 'desktop-guide': '✏️', 'mobile-guide': '📱', todos: '✅' };
const counts: Record<string, number> = {};
const loadViewMeta: AppOperationsContextType['loadViewMeta'] = async (id) => {
  counts[id] = (counts[id] ?? 0) + 1;
  document.documentElement.dataset.metadataLoads = JSON.stringify(counts);
  if (new URLSearchParams(location.search).has('denied') && id === 'mobile-guide') throw new Error('Access denied');
  return {
    view_id: id,
    name: names[id],
    layout: ViewLayout.Document,
    icon: icons[id] ? { ty: ViewIconType.Emoji, value: icons[id] } : undefined,
  } as View;
};
const operations = {
  loadViewMeta,
  toView: async (id: string) => {
    document.documentElement.dataset.navigated = id;
  },
} as AppOperationsContextType;
const doc = createEmptyDocument();
const rootId = getPageId(doc.getMap(YjsEditorKey.data_section) as YSharedRoot);
slateContentInsertToYData(rootId, 0, structuredClone(blocks), doc);
let updates = 0;
document.documentElement.dataset.updates = '0';
doc.on('update', () => {
  document.documentElement.dataset.updates = String(++updates);
});

function Fixture() {
  const [open, setOpen] = useState(false);
  return (
    <MemoryRouter>
      <AFConfigContext.Provider
        value={{ isAuthenticated: false, openLoginModal: () => undefined, updateCurrentUser: async () => undefined }}
      >
        <AppOperationsContext.Provider value={operations}>
          <AppTheme>
            <TooltipProvider>
              <button onClick={() => setOpen(true)}>Present document</button>
              <div data-testid='native-document' className='mx-auto max-w-[1100px] p-6 text-text-primary'>
                <Editor
                  doc={doc as YDoc}
                  viewId='format-source'
                  workspaceId='fixture'
                  readOnly
                  fullWidth
                  loadViewMeta={loadViewMeta}
                />
              </div>
              {open && (
                <DocumentPresenter
                  snapshot={snapshot}
                  onClose={() => {
                    setOpen(false);
                    document.documentElement.dataset.unchanged = String(original === JSON.stringify(snapshot));
                  }}
                  onSource={() => setOpen(false)}
                />
              )}
            </TooltipProvider>
          </AppTheme>
        </AppOperationsContext.Provider>
      </AFConfigContext.Provider>
    </MemoryRouter>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
