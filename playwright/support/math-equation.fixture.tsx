import EventEmitter from 'events';

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import * as Y from 'yjs';

import { initAPIService } from '@/application/services/js-services/http/core';
import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { initializeDocumentStructure } from '@/application/slate-yjs/utils/yjs';
import { BlockType, YDoc } from '@/application/types';
import { Editor } from '@/components/editor';
import AppTheme from '@/components/main/AppTheme';
import { AFConfigContext } from '@/components/main/app.hooks';
import { i18nInstance } from '@/i18n/config';
import en from '@/@types/translations/en.json';
import '@/styles/global.css';

initAPIService({ baseURL: location.origin, gotrueURL: location.origin, wsURL: '' });
const doc = new Y.Doc() as YDoc;
const saved = localStorage.getItem('math-equation-fixture');

if (saved) Y.applyUpdate(doc, new Uint8Array(JSON.parse(saved)));
else initializeDocumentStructure(doc, true);
const events = new EventEmitter();
let editor: YjsEditor;

function Fixture() {
  const [readOnly, setReadOnly] = useState(false);
  const [snapshot, setSnapshot] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const update = () => {
      localStorage.setItem('math-equation-fixture', JSON.stringify([...Y.encodeStateAsUpdate(doc)]));
      setSnapshot(JSON.stringify(yDocToSlateContent(doc)?.children ?? []));
    };

    doc.on('update', update);
    update();
    return () => {
      doc.off('update', update);
    };
  }, []);

  return (
    <MemoryRouter>
      <AFConfigContext.Provider
        value={{ isAuthenticated: false, openLoginModal: () => undefined, updateCurrentUser: async () => undefined }}
      >
        <div style={{ maxWidth: 900, margin: '0 auto', padding: 40 }}>
          <div className='mb-10 flex gap-3 text-sm'>
            <label>
              <input type='checkbox' checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)} />
              Read only
            </label>
            <button onClick={() => (editor as YHistoryEditor).undo()}>Undo</button>
            <button onClick={() => (editor as YHistoryEditor).redo()}>Redo</button>
            <button
              onClick={() => {
                const node = editor.children.find((node) => 'type' in node && node.type === BlockType.EquationBlock);

                if (node && 'blockId' in node)
                  CustomEditor.setBlockData(editor, node.blockId!, { formula: 'collaborator' });
              }}
            >
              Remote edit
            </button>
          </div>
          <Editor
            doc={doc}
            workspaceId='math-workspace'
            viewId='math-document'
            readOnly={readOnly}
            eventEmitter={events}
            addPage={async () => ({ view_id: 'equation-child-page' })}
            onEditorConnected={(value) => {
              editor = value;
              setReady(true);
            }}
          />
          <output hidden data-testid='math-document-snapshot' data-ready={ready}>
            {snapshot}
          </output>
        </div>
      </AFConfigContext.Provider>
    </MemoryRouter>
  );
}

i18nInstance.addResourceBundle('en', 'translation', en, true, true);
void i18nInstance.changeLanguage('en').then(() =>
  createRoot(document.getElementById('root')!).render(
    <AppTheme>
      <Fixture />
    </AppTheme>
  )
);
