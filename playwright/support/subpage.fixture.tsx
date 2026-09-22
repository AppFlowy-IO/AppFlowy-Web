import EventEmitter from 'events';

import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import * as Y from 'yjs';

import { APP_EVENTS } from '@/application/constants';
import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { initializeDocumentStructure } from '@/application/slate-yjs/utils/yjs';
import { View, ViewLayout, YDoc } from '@/application/types';
import { Editor } from '@/components/editor';
import { AFConfigContext } from '@/components/main/app.hooks';

import '@/i18n/config';
import '@/styles/global.css';

const doc = new Y.Doc() as YDoc;
const otherDoc = new Y.Doc() as YDoc;
const events = new EventEmitter();
const pages = new Map<string, View>();
const trashedPageIds = new Set<string>();
let editor: YjsEditor;

initializeDocumentStructure(doc, true);
initializeDocumentStructure(otherDoc, true);

function Fixture() {
  const [opened, setOpened] = useState('');
  const [parentId, setParentId] = useState('parent');
  const [creationAttempts, setCreationAttempts] = useState(0);
  const [trash, setTrash] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [failCreation, setFailCreation] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const publish = (view: View) => {
    pages.set(view.view_id, view);
    events.emit(APP_EVENTS.VIEW_META_CHANGED, view);
    setRevision((v) => v + 1);
  };

  return (
    <MemoryRouter>
      <AFConfigContext.Provider
        value={{ isAuthenticated: false, openLoginModal: () => undefined, updateCurrentUser: async () => undefined }}
      >
        <div style={{ padding: 40 }}>
          <label>
            <input type='checkbox' checked={failCreation} onChange={(e) => setFailCreation(e.target.checked)} />
            Fail creation
          </label>
          <label>
            <input type='checkbox' checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
            Read only
          </label>
          <button onClick={() => setParentId('other')}>Open other parent</button>
          <output data-testid='creation-attempts'>{creationAttempts}</output>
          <output data-testid='opened-page'>{opened}</output>
          <output data-testid='trash'>{trash.join(',')}</output>
          <aside data-testid='child-pages' data-revision={revision}>
            {[...pages.values()]
              .filter((view) => view.parent_view_id === parentId && !trash.includes(view.view_id))
              .map((view) => (
                <div key={view.view_id}>{view.name}</div>
              ))}
          </aside>
          <button
            onClick={() => {
              const view = pages.get(opened);
              if (view) publish({ ...view, name: 'Renamed child' });
            }}
          >
            Rename child
          </button>
          <button
            onClick={() => {
              const block = editor.children.find((node) => 'type' in node && node.type === 'sub_page');
              if (block && 'blockId' in block) {
                (editor as YHistoryEditor).undoManager.stopCapturing();
                CustomEditor.deleteBlock(editor, block.blockId!);
              }
            }}
          >
            Delete subpage block
          </button>
          <button onClick={() => (editor as YHistoryEditor).undo()}>Undo</button>
          <button onClick={() => (editor as YHistoryEditor).redo()}>Redo</button>
          <Editor
            doc={parentId === 'parent' ? doc : otherDoc}
            workspaceId='fixture'
            viewId={parentId}
            readOnly={readOnly}
            eventEmitter={events}
            onEditorConnected={(value) => {
              editor = value;
            }}
            loadViewMeta={async (id) => {
              const view = pages.get(id);
              if (!view && (id === 'parent' || id === 'other'))
                return { view_id: id, name: 'Parent', layout: ViewLayout.Document } as View;
              if (!view) throw new Error('Missing metadata');
              return view;
            }}
            addPage={async (parentId) => {
              setCreationAttempts((count) => count + 1);
              if (failCreation) throw new Error('Creation failed');
              const view_id = crypto.randomUUID();
              publish({ view_id, parent_view_id: parentId, name: 'New child', layout: ViewLayout.Document } as View);
              return { view_id };
            }}
            deletePage={async (id) => {
              trashedPageIds.add(id);
              setTrash([...trashedPageIds]);
            }}
            restorePage={async (id) => {
              trashedPageIds.delete(id);
              setTrash([...trashedPageIds]);
            }}
            loadTrashViews={async () => [...pages.values()].filter((view) => trashedPageIds.has(view.view_id))}
            movePage={async (id, parentId) => {
              publish({ ...pages.get(id)!, parent_view_id: parentId });
            }}
            duplicatePage={async (id, options) => {
              const original = pages.get(id);
              if (!original) throw new Error('Missing source page');
              const view_id = crypto.randomUUID();
              publish({ ...original, view_id, name: `${original.name} (Copy)`, parent_view_id: options?.parentViewId });
              options?.onDuplicated?.(view_id);
            }}
            openPageModal={setOpened}
            navigateToView={async (id) => setOpened(id)}
          />
        </div>
      </AFConfigContext.Provider>
    </MemoryRouter>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
