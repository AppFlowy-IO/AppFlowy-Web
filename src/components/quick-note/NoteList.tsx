import { Divider, IconButton, Tooltip } from '@mui/material';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { QuickNote, QuickNote as QuickNoteType } from '@/application/types';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import AddNote from '@/components/quick-note/AddNote';
import DeleteNoteModal from '@/components/quick-note/DeleteNoteModal';
import { getSummary, getTitle, getUpdateTime } from '@/components/quick-note/utils';

function NoteList({
  list,
  onEnterNode,
  onDelete,
  onScroll,
  onAdd,
}: {
  list: QuickNoteType[];
  onEnterNode: (node: QuickNoteType) => void;
  onAdd: (note: QuickNote) => void;
  onDelete: (id: string) => void;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}) {
  const { t } = useTranslation();
  const renderTitle = useCallback(
    (note: QuickNote) => {
      return getTitle(note).trim() || t('menuAppHeader.defaultNewPageName');
    },
    [t]
  );

  const [openDeleteModal, setOpenDeleteModal] = React.useState(false);
  const [selectedNote, setSelectedNote] = React.useState<QuickNoteType | null>(null);
  const [hoverId, setHoverId] = React.useState<string | null>(null);

  return (
    <>
      {list.length === 0 && (
        <div className={'flex h-full w-full items-center justify-center text-center text-sm text-text-secondary'}>
          {t('quickNote.quickNotesEmpty')}
        </div>
      )}
      {list && (
        <div onScroll={onScroll} className={'appflowy-custom-scroller flex h-full flex-col gap-3   overflow-y-auto'}>
          <div className={'flex flex-col'}>
            {list.map((note, index) => {
              return (
                <React.StrictMode key={note.id}>
                  <div
                    onClick={() => onEnterNode(note)}
                    onMouseEnter={() => setHoverId(note.id)}
                    onMouseLeave={() => setHoverId(null)}
                    key={note.id}
                    className={`relative cursor-pointer overflow-hidden px-5 text-sm hover:bg-fill-theme-select`}
                  >
                    <div
                      className={`w-full 
                    ${
                      index === list.length - 1 ? '' : 'border-b'
                    } flex min-h-[68px] flex-col justify-center gap-1 border-line-card py-4`}
                    >
                      <div className={'w-full truncate font-medium'}>{renderTitle(note)}</div>
                      <div className={'flex w-full gap-2 font-normal'}>
                        <span className={'text-text-primary'}>{getUpdateTime(note)}</span>
                        <span className={'flex-1 truncate text-text-secondary'}>
                          {getSummary(note) || t('quickNote.noAdditionalText')}
                        </span>
                      </div>
                    </div>
                    {hoverId === note.id ? (
                      <div
                        className={
                          'absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-[8px] border border-border-primary bg-background-primary p-1'
                        }
                      >
                        <Tooltip placement={'top'} title={t('button.edit')}>
                          <IconButton
                            onClick={(e) => {
                              e.stopPropagation();
                              onEnterNode(note);
                            }}
                            size={'small'}
                          >
                            <EditIcon />
                          </IconButton>
                        </Tooltip>
                        <Divider orientation={'vertical'} flexItem className={'my-1'} />
                        <Tooltip placement={'top'} title={t('button.delete')}>
                          <IconButton
                            onClick={(e) => {
                              e.stopPropagation();

                              setSelectedNote(note);
                              setOpenDeleteModal(true);
                            }}
                            size={'small'}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Tooltip>
                      </div>
                    ) : null}
                  </div>
                </React.StrictMode>
              );
            })}
          </div>
          {selectedNote && (
            <DeleteNoteModal
              onDelete={onDelete}
              open={openDeleteModal}
              onClose={() => {
                setOpenDeleteModal(false);
                setSelectedNote(null);
              }}
              note={selectedNote}
            />
          )}
        </div>
      )}

      <div className={'h-fit min-h-[46px] w-full bg-bg-base px-4 py-2'}>
        <AddNote onAdd={onAdd} onEnterNote={onEnterNode} />
      </div>
    </>
  );
}

export default NoteList;
