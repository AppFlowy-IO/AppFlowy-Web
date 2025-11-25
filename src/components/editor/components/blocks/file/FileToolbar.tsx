import { OutlinedInput } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Element } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as DownloadIcon } from '@/assets/icons/save_as.svg';
import { NormalModal } from '@/components/_shared/modal';
import ActionButton from '@/components/editor/components/toolbar/selection-toolbar/actions/ActionButton';
import { FileNode } from '@/components/editor/editor.type';
import { downloadFile } from '@/utils/download';

function FileToolbar({ node }: { node: FileNode }) {
  const editor = useSlateStatic() as YjsEditor;
  const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);
  const { t } = useTranslation();
  const url = node.data.url || '';
  const name = node.data.name || '';
  const [open, setOpen] = useState<boolean>(false);
  const [fileName, setFileName] = useState<string>(name);

  const onDelete = () => {
    CustomEditor.deleteBlock(editor, node.blockId);
  };

  const onDownload = () => {
    if (!url) return;

    void downloadFile(url, name);
  };

  const onUpdateName = () => {
    if (!fileName || fileName === name) return;
    CustomEditor.setBlockData(editor, node.blockId, { name: fileName });
    setOpen(false);
  };

  const inputRef = React.useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      inputRef.current = null;
    }
  }, [open]);

  return (
    <div onClick={(e) => e.stopPropagation()} className={'absolute right-2.5 top-2.5 z-10'}>
      <div className={'flex space-x-1 rounded-[8px] border border-border-primary bg-fill-toolbar p-1 shadow '}>
        <ActionButton onClick={onDownload} tooltip={t('button.download')}>
          <DownloadIcon />
        </ActionButton>

        {!readOnly && (
          <>
            <ActionButton
              onClick={() => {
                setOpen(true);
              }}
              tooltip={t('document.plugins.file.renameFile.title')}
            >
              <EditIcon />
            </ActionButton>
            <ActionButton onClick={onDelete} tooltip={t('button.delete')}>
              <DeleteIcon />
            </ActionButton>
            <NormalModal
              open={open}
              disableRestoreFocus={true}
              onClose={() => setOpen(false)}
              okText={t('button.save')}
              onOk={onUpdateName}
              title={
                <div className={'flex items-center justify-start font-semibold'}>
                  {t('document.plugins.file.renameFile.title')}
                </div>
              }
            >
              <div className={'flex w-[560px] max-w-full flex-col gap-2'}>
                <div className={'text-text-secondary'}>{t('trash.pageHeader.fileName')}</div>
                <OutlinedInput
                  value={fileName}
                  fullWidth={true}
                  autoFocus={open}
                  inputRef={(input: HTMLInputElement) => {
                    if (!input) return;
                    if (!inputRef.current) {
                      setTimeout(() => {
                        input.setSelectionRange(0, input.value.length);
                      }, 50);

                      inputRef.current = input;
                    }
                  }}
                  onClick={(e) => {
                    if (e.detail > 2) {
                      const target = e.target as HTMLInputElement;

                      // select all text on triple click
                      target.setSelectionRange(0, target.value.length);
                    }
                  }}
                  onChange={(e) => setFileName(e.target.value)}
                  size={'small'}
                />
              </div>
            </NormalModal>
          </>
        )}
      </div>
    </div>
  );
}

export default FileToolbar;
