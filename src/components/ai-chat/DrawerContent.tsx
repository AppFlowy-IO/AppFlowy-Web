import { YjsEditor } from '@/application/slate-yjs';
import { UIVariant, ViewMetaProps, YDoc } from '@/application/types';
import { useAIChatContext } from '@/components/ai-chat/AIChatProvider';
import { insertDataToDoc } from '@/components/ai-chat/utils';
import { useAppHandlers, useAppView } from '@/components/app/app.hooks';
import { Document } from '@/components/document';
import RecordNotFound from '@/components/error/RecordNotFound';
import { debounce } from 'lodash-es';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import smoothScrollIntoViewIfNeeded from 'smooth-scroll-into-view-if-needed';

function DrawerContent({
  openViewId,
}: {
  openViewId: string;
}) {
  const {
    toView,
    loadViewMeta,
    createRowDoc,
    loadView,
    updatePage,
    addPage,
    deletePage,
    openPageModal,
    loadViews,
    setWordCount,
    uploadFile,
  } = useAppHandlers();
  const {
    getInsertData,
    clearInsertData,
    drawerOpen,
  } = useAIChatContext();

  const [doc, setDoc] = React.useState<{
    id: string;
    doc: YDoc;
  } | undefined>(undefined);

  const initialScrolling = React.useRef(false);
  const [notFound, setNotFound] = React.useState(false);
  const [editor, setEditor] = useState<YjsEditor | undefined>(undefined);

  const onEditorConnected = useCallback((editor: YjsEditor) => {
    setEditor(editor);
  }, []);

  const loadPageDoc = useCallback(async(id: string) => {

    setNotFound(false);
    setDoc(undefined);
    try {
      const doc = await loadView(id);

      setDoc({ doc, id });
    } catch(e) {
      setNotFound(true);
      console.error(e);
    }

  }, [loadView]);

  const view = useAppView(openViewId);

  useEffect(() => {
    if(openViewId) {
      void loadPageDoc(openViewId);
    } else {
      setDoc(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openViewId]);

  useEffect(() => {
    const insertData = getInsertData(openViewId);

    if(!doc || !insertData || !drawerOpen || doc.id !== openViewId || editor === undefined) {
      return;
    }

    try {
      editor.deselect();
      insertDataToDoc(doc.doc, insertData);

      clearInsertData(openViewId);
    } catch(e) {
      console.error(e);
    }

    initialScrolling.current = true;

  }, [editor, clearInsertData, doc, getInsertData, openViewId, drawerOpen]);

  useEffect(() => {
    const container = document.querySelector('.ai-chat-view');

    const debounceStopScrolling = debounce(() => {
      initialScrolling.current = false;
    }, 500);

    const observer = new MutationObserver(() => {
      if(!initialScrolling.current) {
        return;
      }

      const textBox = document.querySelector('.ai-chat-view [role="textbox"]');

      if(textBox) {
        void smoothScrollIntoViewIfNeeded(textBox, {
          behavior: 'smooth',
          block: 'end',
          onScrollChange: () => {
            debounceStopScrolling();
          },
        });

        // focus to end of the text
        const range = document.createRange();

        range.selectNodeContents(textBox);
        range.collapse(false);
        const selection = window.getSelection();

        if(selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    });

    if(container) {
      observer.observe(container, {
        childList: true,
        subtree: true,
      });
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  const viewMeta: ViewMetaProps | null = useMemo(() => {
    return view ? {
      name: view.name,
      icon: view.icon || undefined,
      cover: view.extra?.cover || undefined,
      layout: view.layout,
      visibleViewIds: [],
      viewId: view.view_id,
      extra: view.extra,
    } : null;
  }, [view]);

  const handleUploadFile = useCallback((file: File) => {
    if(view && uploadFile) {
      return uploadFile(view.view_id, file);
    }

    return Promise.reject();
  }, [uploadFile, view]);

  if(notFound) {
    return (
      <RecordNotFound />
    );
  }

  return (
    <div className={'h-fit w-full relative ai-chat-view'}>
      {
        doc && viewMeta && (
          <Document
            doc={doc.doc}
            readOnly={false}
            viewMeta={viewMeta}
            navigateToView={toView}
            loadViewMeta={loadViewMeta}
            createRowDoc={createRowDoc}
            loadView={loadView}
            updatePage={updatePage}
            addPage={addPage}
            deletePage={deletePage}
            openPageModal={openPageModal}
            loadViews={loadViews}
            onWordCountChange={setWordCount}
            uploadFile={handleUploadFile}
            variant={UIVariant.App}
            onEditorConnected={onEditorConnected}
          />
        )
      }

    </div>
  );
}

export default DrawerContent;