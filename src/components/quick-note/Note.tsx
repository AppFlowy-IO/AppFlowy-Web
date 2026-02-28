import { Editor, EditorData, EditorProvider, FixedToolbar, useEditor } from '@appflowyinc/editor';

import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';

import '@appflowyinc/editor/style';
import React, { useCallback, useContext, useEffect, useMemo } from 'react';

import { QuickNote, QuickNoteEditorData } from '@/application/types';
import { QuickNoteService } from '@/application/services/domains';
import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { ThemeModeContext } from '@/components/main/useAppThemeMode';
import { useAddNode } from '@/components/quick-note/QuickNote.hooks';
import { getTitle } from '@/components/quick-note/utils';

import { CircularProgress, IconButton, Tooltip } from '@mui/material';
import dayjs from 'dayjs';
import { debounce } from 'lodash-es';
import { useTranslation } from 'react-i18next';

function Note({
  note,
  onUpdateData,
  onEnterNote,
  onAdd,
}: {
  note: QuickNote;
  onUpdateData: (data: QuickNoteEditorData[]) => void;
  onEnterNote: (node: QuickNote) => void;
  onAdd: (note: QuickNote) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;

    if (!el) return;

    setTimeout(() => {
      const editorDom = el.querySelector('.appflowy-editor div[role="textbox"]') as HTMLElement;

      if (!editorDom) return;

      const sel = window.getSelection();
      const range = document.createRange();

      range.selectNodeContents(editorDom);
      range.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }, 200);

    //eslint-disable-next-line
  }, [note.id]);

  return (
    <div ref={ref} className={'flex flex-1 overflow-hidden'}>
      <EditorProvider>
        <NoteEditor onAdd={onAdd} onEnterNote={onEnterNote} note={note} onUpdateData={onUpdateData} />
      </EditorProvider>
    </div>
  );
}

function NoteEditor({
  note,
  onUpdateData,
  onEnterNote,
  onAdd,
}: {
  note: QuickNote;
  onUpdateData: (data: QuickNoteEditorData[]) => void;
  onEnterNote: (node: QuickNote) => void;
  onAdd: (note: QuickNote) => void;
}) {
  const { i18n, t } = useTranslation();
  const locale = useMemo(
    () => ({
      lang: i18n.language,
    }),
    [i18n.language]
  );

  const [, setClock] = React.useState(0);
  const isDark = useContext(ThemeModeContext)?.isDark;
  const theme = isDark ? 'dark' : 'light';

  const editor = useEditor();

  useEffect(() => {
    editor.applyData(note.data as EditorData);
    setClock((prev) => prev + 1);
    // eslint-disable-next-line
  }, [editor, note.id]);

  const currentWorkspaceId = useCurrentWorkspaceId();

  const handleUpdate = useCallback(
    async (data: EditorData) => {
      if (!currentWorkspaceId) return;
      try {
        await QuickNoteService.update(currentWorkspaceId, note.id, data as QuickNoteEditorData[]);
        // eslint-disable-next-line
      } catch (e: any) {
        console.error(e);
      }
    },
    [currentWorkspaceId, note.id]
  );

  const updatedAt = useMemo(() => {
    const date = dayjs(note.last_updated_at);

    return date.format('MMMM D, YYYY') + ' at ' + date.format('h:mm A');
  }, [note.last_updated_at]);

  const debounceUpdate = useMemo(() => debounce(handleUpdate, 300), [handleUpdate]);

  const handleChange = useCallback(
    (data: EditorData) => {
      void debounceUpdate(data);
      onUpdateData(data as QuickNoteEditorData[]);
    },
    [debounceUpdate, onUpdateData]
  );

  useEffect(() => {
    return () => {
      void debounceUpdate.flush();
    };
  }, [debounceUpdate]);

  const { handleAdd, loading } = useAddNode({
    onEnterNote,
    onAdd,
  });

  const CustomToolbar = useCallback(() => {
    return (
      <div className={'flex w-full flex-col'}>
        <div className={'flex w-full items-center justify-between gap-2'}>
          <div className={'flex-1'}>
            <FixedToolbar />
          </div>
          <div className={'mx-3 flex w-10 items-center justify-center rounded-[8px] bg-fill-content-hover'}>
            <Tooltip title={t('quickNote.addNote')} placement={'top'}>
              <IconButton disabled={getTitle(note) === ''} className={'hover:!bg-transparent'} onClick={handleAdd}>
                {loading ? <CircularProgress className={'h-5 w-5'} /> : <AddIcon className={'h-5 w-5 font-medium'} />}
              </IconButton>
            </Tooltip>
          </div>
        </div>

        <div className={'my-1 w-full text-center text-xs text-text-secondary'}>{updatedAt}</div>
      </div>
    );
  }, [handleAdd, loading, note, t, updatedAt]);

  return (
    <>
      <Editor
        modalZIndex={1500}
        initialValue={note.data as EditorData}
        locale={locale}
        onChange={handleChange}
        theme={theme}
        ToolbarComponent={CustomToolbar}
      />
    </>
  );
}

export default Note;
