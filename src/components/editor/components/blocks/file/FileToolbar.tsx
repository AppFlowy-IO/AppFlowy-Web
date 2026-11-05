import { IconButton, Menu, MenuItem, OutlinedInput } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Element } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as DownloadIcon } from '@/assets/icons/save_as.svg';
import { NormalModal } from '@/components/_shared/modal';
import { FileNode } from '@/components/editor/editor.type';
import { downloadFile } from '@/utils/download';

function FileToolbar({ node }: { node: FileNode }) {
  const editor = useSlateStatic() as YjsEditor;
  const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);
  const { t } = useTranslation();
  const url = node.data.url || '';
  const name = node.data.name || '';
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
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
    <div onClick={(e) => e.stopPropagation()} className='flex shrink-0 items-center'>
      <IconButton
        aria-label={t('button.more')}
        aria-haspopup='menu'
        aria-expanded={Boolean(anchor)}
        onClick={(e) => setAnchor(e.currentTarget)}
        className='!h-7 !w-7 !rounded-md !p-1'
      >
        <MoreIcon className='h-5 w-5 text-icon-secondary' />
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            onDownload();
          }}
        >
          <DownloadIcon className='mr-2 h-5 w-5' />
          {t('button.download')}
        </MenuItem>
        {!readOnly && [
          <MenuItem
            key='rename'
            onClick={() => {
              setAnchor(null);
              setOpen(true);
            }}
          >
            <EditIcon className='mr-2 h-5 w-5' />
            {t('document.plugins.file.renameFile.title')}
          </MenuItem>,
          <MenuItem
            key='delete'
            onClick={() => {
              setAnchor(null);
              onDelete();
            }}
            className='!text-text-error'
          >
            <DeleteIcon className='mr-2 h-5 w-5' />
            {t('button.delete')}
          </MenuItem>,
        ]}
      </Menu>
      {!readOnly && (
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
      )}
    </div>
  );
}

export default FileToolbar;
