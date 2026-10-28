import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { type Element, type Text } from 'slate';

import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { createEmptyDocument, getPageId } from '@/application/slate-yjs/utils/yjs';
import { MentionType, YjsEditorKey, type YSharedRoot, type YDoc } from '@/application/types';
import { AppOperationsContext, type AppOperationsContextType } from '@/components/app/contexts/AppOperationsContext';
import { AFConfigContext } from '@/components/main/app.hooks';
import AppTheme from '@/components/main/AppTheme';
import { Editor } from '@/components/editor/Editor';
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
const mode = new URLSearchParams(location.search).get('mode');
const headings =
  mode === 'empty'
    ? []
    : mode === 'long'
    ? Array.from({ length: 40 }, (_, index) => block(`h-${index}`, 'heading', `Section ${index + 1}`, { level: 2 }))
    : [
        block('intro', 'heading', 'Introduction', { level: 1 }),
        block('intro-body', 'paragraph', 'Introduction content.'),
        block('detail', 'heading', 'Details', { level: 3 }),
        block('detail-body', 'paragraph', 'Detail content.'),
        block('excluded', 'heading', 'Deeper detail', { level: 4 }),
        block('toggle', 'toggle_list', 'Collapsed group', { collapsed: true }, [
          ...Array.from({ length: 20 }, (_, index) =>
            block(`filler-${index}`, 'paragraph', 'This content comes before the nested heading. '.repeat(5))
          ),
          block('nested', 'heading', 'Nested target', { level: 2 }),
          block('nested-body', 'paragraph', 'Nested content revealed locally.'),
        ]),
        block('toggle-heading', 'toggle_list', 'Toggle heading', { collapsed: true, level: 2 }),
        block(
          'inline-label',
          'heading',
          [
            { text: '$', mention: { type: MentionType.Person, person_id: 'ada', person_name: 'Ada' } },
            { text: ' ' },
            { text: '$', formula: 'x^2' },
          ],
          { level: 2 }
        ),
      ];
const blocks = [
  block('contents', 'outline', '', { depth: mode === 'filtered' ? 1 : 3, bgColor: 'appflowy_them_color_tint5' }),
  block('toc-end', 'divider', ''),
  ...(mode === 'filtered' ? [block('deep', 'heading', 'A deep heading', { level: 4 })] : headings),
];
const snapshot = snapshotFromSlate('outline-source', 'Document contents', { type: 'page', children: blocks } as Element);
const original = JSON.stringify(snapshot);
const operations = {} as AppOperationsContextType;
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
                <Editor doc={doc as YDoc} viewId='outline-source' workspaceId='fixture' readOnly fullWidth />
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
