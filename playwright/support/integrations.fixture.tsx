import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createEditor, Element } from 'slate';
import { Slate, withReact } from 'slate-react';

import { initAPIService } from '@/application/services/js-services/http/core';
import { withYjs } from '@/application/slate-yjs';
import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { slateContentInsertToYData, yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { getBlock, getChildrenArray } from '@/application/slate-yjs/utils/yjs';
import { BlockType, CollabOrigin, CreatePagePayload, YjsEditorKey } from '@/application/types';
import { AppOperationsContext, AppOperationsContextType } from '@/components/app/contexts/AppOperationsContext';
import { AppOutlineContext } from '@/components/app/contexts/AppOutlineContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { GoogleCalendarIntegration } from '@/components/app/integrations/GoogleCalendarIntegration';
import { AIMeetingRecording } from '@/components/editor/components/blocks/ai-meeting/AIMeetingRecording';
import { GoogleDriveBrowser } from '@/components/editor/components/blocks/google-drive/GoogleDriveBrowser';
import '@/i18n/config';
import '@/styles/global.css';

initAPIService({ baseURL: location.origin, gotrueURL: location.origin, wsURL: '' });

type PageNode = { type: string; data?: { delta?: { insert: string }[] }; children?: PageNode[] };
function toSlate(node: PageNode): Element {
  return {
    type: node.type,
    data: node.data ?? {},
    children: [
      { type: YjsEditorKey.text, children: [{ text: node.data?.delta?.map((op) => op.insert).join('') ?? '' }] },
      ...(node.children ?? []).map(toSlate),
    ],
  } as unknown as Element;
}

function Recording({ payload }: { payload: CreatePagePayload }) {
  const [snapshot, setSnapshot] = useState('');
  const [finished, setFinished] = useState(false);
  const { editor, doc, blockId, transcriptBlockId } = useMemo(() => {
    const doc = withTestingYDoc('page');
    const root = (payload.page_data as { children: PageNode[] }).children.map(toSlate);
    const [blockId] = slateContentInsertToYData('page', 0, root, doc);
    const editor = withReact(withYjs(createEditor(), doc, { localOrigin: CollabOrigin.Local, readOnly: false }));
    const block = getBlock(blockId, editor.sharedRoot);
    const transcriptBlockId = getChildrenArray(block.get(YjsEditorKey.block_children), editor.sharedRoot)
      .toArray()
      .find(
        (id) => getBlock(id, editor.sharedRoot).get(YjsEditorKey.block_type) === BlockType.AIMeetingTranscriptionBlock
      )!;

    return { editor, doc, blockId, transcriptBlockId };
  }, [payload]);

  useEffect(() => {
    editor.connect();
    const update = () => setSnapshot(JSON.stringify(doc.toJSON()));

    doc.on('update', update);
    update();
    return () => {
      doc.off('update', update);
      editor.disconnect();
    };
  }, [doc, editor]);

  return (
    <Slate editor={editor} initialValue={yDocToSlateContent(doc).children}>
      <h2>{payload.name}</h2>
      <AIMeetingRecording
        workspaceId='workspace'
        viewId='meeting-page'
        blockId={blockId}
        transcriptBlockId={transcriptBlockId}
        onFinished={() => setFinished(true)}
      />
      <output data-testid='document-content' className='block max-h-32 overflow-auto text-xs'>
        {snapshot}
      </output>
      {finished && <p>Transcription saved</p>}
    </Slate>
  );
}

function Fixture() {
  const [selected, setSelected] = useState('');
  const [payload, setPayload] = useState<CreatePagePayload>();
  const [privateSpace, setPrivateSpace] = useState<number>();
  const [opened, setOpened] = useState(false);
  const operations = useMemo(
    () =>
      ({
        createSpaceWithInitialPage: async (value) => {
          setPayload(value.initial_page);
          setPrivateSpace(value.space_permission);
          return { space: { view_id: 'private-space' }, page: { view_id: 'meeting-page' } };
        },
        toView: async () => {
          setOpened(true);
        },
      } as AppOperationsContextType),
    []
  );

  return (
    <AuthInternalContext.Provider
      value={{
        currentWorkspaceId: 'workspace',
        isAuthenticated: true,
        aiEnabled: true,
        onChangeWorkspace: async () => undefined,
      }}
    >
      <AppOutlineContext.Provider value={{ outline: [] }}>
        <AppOperationsContext.Provider value={operations}>
          <main className='mx-auto max-w-3xl p-8'>
            <h1 className='mb-4 text-2xl'>Connected accounts</h1>
            <GoogleDriveBrowser
              workspaceId='workspace'
              onSelect={(file, email) => setSelected(`${file.name} · ${email}`)}
            />
            <output data-testid='selected-file'>{selected}</output>
            <GoogleCalendarIntegration />
            {opened && payload && (
              <section className='mt-8'>
                <Recording payload={payload} />
                <output data-testid='space-permission'>{privateSpace}</output>
              </section>
            )}
          </main>
        </AppOperationsContext.Provider>
      </AppOutlineContext.Provider>
    </AuthInternalContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
