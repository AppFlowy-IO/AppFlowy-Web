import Dialog from '@mui/material/Dialog';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { slateContentInsertToYData, yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { createEmptyDocument, getPageId } from '@/application/slate-yjs/utils/yjs';
import { YjsEditorKey, type YDoc, type YSharedRoot } from '@/application/types';
import { AppOperationsContext, type AppOperationsContextType } from '@/components/app/contexts/AppOperationsContext';
import { Editor } from '@/components/editor/Editor';
import { parseMarkdown } from '@/components/editor/parsers/markdown-parser';
import { parsedBlockToSlateElement } from '@/components/editor/parsers/parsed-block-to-slate';
import { revealDocumentBlock } from '@/components/editor/utils/reveal-document-block';
import { AFConfigContext } from '@/components/main/app.hooks';
import AppTheme from '@/components/main/AppTheme';
import { resolveMapReferences } from '@/components/presentation/mindmap-references';
import MindMapViewer from '@/components/presentation/MindMapViewer';
import '@/components/presentation/presentation.css';
import { snapshotFromSlate } from '@/components/presentation/snapshot-adapter';
import type { MindMap, MindMapImport } from '@/components/presentation/types';
import { TooltipProvider } from '@/components/ui/tooltip';
import '@/styles/global.css';

const input: { title: string; markdown: string; map: MindMap; mapImport: MindMapImport } = await fetch(
  '/presentation-source-input.json'
).then((r) => r.json());
const blocks = parseMarkdown(input.markdown).map(parsedBlockToSlateElement);
const doc = createEmptyDocument();

slateContentInsertToYData(
  getPageId(doc.getMap(YjsEditorKey.data_section) as YSharedRoot),
  0,
  structuredClone(blocks),
  doc
);
const snapshot = snapshotFromSlate('source-navigation-page', input.title, yDocToSlateContent(doc));
const resolved = resolveMapReferences(input.map, snapshot, input.mapImport);
const refs = [...new Set(input.map.nodes.flatMap((node) => node.sourceIds))];
function Fixture() {
  const [open, setOpen] = useState(false);

  return (
    <MemoryRouter>
      <AFConfigContext.Provider
        value={{ isAuthenticated: false, openLoginModal: () => undefined, updateCurrentUser: async () => undefined }}
      >
        <AppOperationsContext.Provider value={{} as AppOperationsContextType}>
          <AppTheme>
            <TooltipProvider>
              <button onClick={() => setOpen(true)}>Present mind map</button>
              <output hidden data-testid='reference-resolution' data-total={refs.length} data-resolved={resolved.size}>
                {JSON.stringify({
                  resolved: Object.fromEntries(resolved),
                  unresolved: refs.filter((id) => !resolved.has(id)),
                })}
              </output>
              <div className='mx-auto max-w-[1100px] p-6 text-text-primary'>
                <Editor doc={doc as YDoc} viewId={snapshot.pageId} workspaceId='fixture' readOnly fullWidth />
              </div>
              <Dialog open={open} fullScreen onClose={() => setOpen(false)}>
                {open && (
                  <div className='ps-root'>
                    <MindMapViewer
                      map={input.map}
                      isPro
                      mapStyle={{ structure: 'balanced', branchLine: 'curved' }}
                      canGenerate={false}
                      onGenerate={() => undefined}
                      onSlides={() => undefined}
                      onClosePresentation={() => setOpen(false)}
                      onSource={(ref) => {
                        const id = resolved.get(ref);
                        if (!id) return;
                        setOpen(false);
                        document.documentElement.dataset.openedSource = id;
                        document.documentElement.dataset.revealed = String(revealDocumentBlock(snapshot.pageId, id));
                      }}
                    />
                  </div>
                )}
              </Dialog>
            </TooltipProvider>
          </AppTheme>
        </AppOperationsContext.Provider>
      </AFConfigContext.Provider>
    </MemoryRouter>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
