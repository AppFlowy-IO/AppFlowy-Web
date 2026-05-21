import { Button } from '@mui/material';
import { PopoverOrigin } from '@mui/material/Popover/Popover';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Editor, Transforms } from 'slate';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId, getBlockEntry } from '@/application/slate-yjs/utils/editor';
import {
  AlignType,
  BlockData,
  BlockType,
  LinkPreviewBlockData,
  LinkPreviewType,
  MentionType,
  VideoBlockData,
  VideoType,
} from '@/application/types';
import { ReactComponent as AtIcon } from '@/assets/icons/at.svg';
import { ReactComponent as LinkIcon } from '@/assets/icons/link.svg';
import { ReactComponent as RefPageIcon } from '@/assets/icons/ref_page.svg';
import { ReactComponent as VideoIcon } from '@/assets/icons/video.svg';
import { calculateOptimalOrigins, Popover } from '@/components/_shared/popover';
import { usePanelContext } from '@/components/editor/components/panels/Panels.hooks';
import { PanelType } from '@/components/editor/components/panels/PanelsContext';
import { processUrl } from '@/utils/url';
import { isValidVideoUrl, videoTypeData } from '@/utils/video-url';

import { PasteAsMenuType } from './constants';
import type { PasteAsMenuPayload } from './constants';

function isValidPasteRange(editor: YjsEditor, payload: PasteAsMenuPayload) {
  const { range, url } = payload;

  if (!Editor.hasPath(editor, range.anchor.path) || !Editor.hasPath(editor, range.focus.path)) {
    return false;
  }

  return editor.string(range) === url;
}

export function PasteAsPanel() {
  const { closePanel, getPasteAsPayload, isPanelOpen, panelPosition } = usePanelContext();
  const editor = useSlateStatic() as YjsEditor;
  const { t } = useTranslation();
  const open = isPanelOpen(PanelType.PasteAs);
  const [selectedType, setSelectedType] = useState<PasteAsMenuType>(PasteAsMenuType.Mention);
  const selectedTypeRef = useRef<PasteAsMenuType>(PasteAsMenuType.Mention);
  const [transformOrigin, setTransformOrigin] = useState<PopoverOrigin | undefined>(undefined);

  const turnIntoBlock = useCallback(
    (type: BlockType, data: BlockData) => {
      const block = getBlockEntry(editor);

      if (!block) return;

      const [node] = block;
      const blockId = node.blockId;

      if (!blockId) return;

      const isEmpty = !CustomEditor.getBlockTextContent(node, 2);

      const newBlockId = isEmpty
        ? CustomEditor.turnToBlock(editor, blockId, type, data)
        : CustomEditor.addBelowBlock(editor, blockId, type, data);

      if (newBlockId) {
        const entry = findSlateEntryByBlockId(editor, newBlockId);

        if (!entry) return;

        ReactEditor.focus(editor);
        Transforms.select(editor, Editor.start(editor, entry[1]));
      } else {
        ReactEditor.focus(editor);
      }
    },
    [editor]
  );

  const selectPasteRange = useCallback(
    (payload: PasteAsMenuPayload) => {
      if (!isValidPasteRange(editor, payload)) return false;

      ReactEditor.focus(editor);
      Transforms.select(editor, payload.range);
      return true;
    },
    [editor]
  );

  const handleSelect = useCallback(
    (type: PasteAsMenuType) => {
      const payload = getPasteAsPayload();

      closePanel();

      if (!payload || !selectPasteRange(payload)) return;

      if (type === PasteAsMenuType.Url) {
        Transforms.collapse(editor, { edge: 'end' });
        return;
      }

      const url = processUrl(payload.url) || payload.url;

      Transforms.delete(editor);

      if (type === PasteAsMenuType.Mention) {
        Transforms.insertNodes(
          editor,
          {
            text: '@',
            mention: {
              type: MentionType.externalLink,
              url,
            },
          },
          { select: true, voids: false }
        );
        Transforms.collapse(editor, { edge: 'end' });
        return;
      }

      if (type === PasteAsMenuType.Embed && isValidVideoUrl(url)) {
        turnIntoBlock(BlockType.VideoBlock, {
          url,
          align: AlignType.Center,
          ...videoTypeData(VideoType.External),
        } as VideoBlockData);
        return;
      }

      turnIntoBlock(BlockType.LinkPreview, {
        url,
        preview_type: type === PasteAsMenuType.Embed ? LinkPreviewType.Embed : LinkPreviewType.Bookmark,
      } as LinkPreviewBlockData);
    },
    [closePanel, editor, getPasteAsPayload, selectPasteRange, turnIntoBlock]
  );

  const options = useMemo(
    () => [
      {
        icon: <AtIcon />,
        label: t('document.plugins.urlPreview.pasteAs.mention', { defaultValue: 'Mention' }),
        type: PasteAsMenuType.Mention,
      },
      {
        icon: <LinkIcon />,
        label: t('document.plugins.urlPreview.pasteAs.url', { defaultValue: 'URL' }),
        type: PasteAsMenuType.Url,
      },
      {
        icon: <RefPageIcon />,
        label: t('document.plugins.urlPreview.pasteAs.bookmark', { defaultValue: 'Bookmark' }),
        type: PasteAsMenuType.Bookmark,
      },
      {
        icon: <VideoIcon />,
        label: t('document.plugins.urlPreview.pasteAs.embed', { defaultValue: 'Embed' }),
        type: PasteAsMenuType.Embed,
      },
    ],
    [t]
  );

  useEffect(() => {
    selectedTypeRef.current = selectedType;
  }, [selectedType]);

  useEffect(() => {
    if (open) {
      setSelectedType(PasteAsMenuType.Mention);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !panelPosition) return;

    const origins = calculateOptimalOrigins(panelPosition, 260, 184, undefined, 16);

    setTransformOrigin(origins.transformOrigin);
  }, [open, panelPosition]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const index = options.findIndex((option) => option.type === selectedTypeRef.current);

      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          e.stopPropagation();
          handleSelect(selectedTypeRef.current);
          break;
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault();
          e.stopPropagation();

          const nextIndex =
            e.key === 'ArrowDown'
              ? (index + 1) % options.length
              : (index - 1 + options.length) % options.length;

          setSelectedType(options[nextIndex].type);
          break;
        }

        default:
          break;
      }
    };

    const slateDom = ReactEditor.toDOMNode(editor, editor);

    slateDom.addEventListener('keydown', handleKeyDown);
    return () => {
      slateDom.removeEventListener('keydown', handleKeyDown);
    };
  }, [editor, handleSelect, open, options]);

  return (
    <Popover
      adjustOrigins={false}
      anchorPosition={panelPosition}
      anchorReference={'anchorPosition'}
      data-testid={'paste-as-panel'}
      disableAutoFocus={true}
      disableEnforceFocus={true}
      disableRestoreFocus={true}
      onClose={closePanel}
      onMouseDown={(e) => e.preventDefault()}
      open={open}
      transformOrigin={transformOrigin}
    >
      <div className={'flex w-[260px] flex-col gap-1 p-2'}>
        <div className={'px-2 py-1 text-xs font-medium text-text-secondary'}>
          {t('document.plugins.urlPreview.pasteAs.title', { defaultValue: 'Paste as' })}
        </div>
        {options.map((option) => (
          <Button
            color={'inherit'}
            data-testid={`paste-as-${option.type}`}
            key={option.type}
            onClick={() => handleSelect(option.type)}
            onMouseEnter={() => setSelectedType(option.type)}
            size={'small'}
            startIcon={option.icon}
            className={`h-9 justify-start hover:bg-fill-content-hover ${
              selectedType === option.type ? 'bg-fill-content-hover' : ''
            }`}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </Popover>
  );
}

export default PasteAsPanel;
