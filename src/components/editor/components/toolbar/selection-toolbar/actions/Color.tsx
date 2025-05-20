import { Tooltip } from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { EditorMarkFormat } from '@/application/slate-yjs/types';
import { ReactComponent as TextSvg } from '@/assets/icons/format_text.svg';
import { ReactComponent as ColorSvg } from '@/assets/icons/text_color.svg';
import { Popover } from '@/components/_shared/popover';
import { useSelectionToolbarContext } from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks';
import { renderColor } from '@/utils/color';

import ActionButton from './ActionButton';

function Color() {
  const { t } = useTranslation();
  const { visible: toolbarVisible } = useSelectionToolbarContext();
  const editor = useSlateStatic() as YjsEditor;
  const marks = CustomEditor.getAllMarks(editor);
  const activeFontColor = marks.find((mark) => mark[EditorMarkFormat.FontColor])?.[EditorMarkFormat.FontColor];

  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const open = Boolean(anchorEl);

  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!toolbarVisible) {
      setAnchorEl(null);
    }
  }, [toolbarVisible]);

  useEffect(() => {
    if (wrapperRef.current) {
      const svg = wrapperRef.current.querySelector('svg');

      if (svg) {
        const bar = svg.querySelector('[class*="color-bar"]');

        if (bar) {
          bar.setAttribute('stroke', activeFontColor || 'currentColor');
        }
      }
    }
  }, [activeFontColor]);

  const onClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    setAnchorEl(e.currentTarget);
  }, []);

  const handleClose = useCallback(() => {
    setAnchorEl(null);
  }, []);

  const handlePickedColor = useCallback(
    (format: EditorMarkFormat, color: string) => {
      if (color) {
        CustomEditor.addMark(editor, {
          key: format,
          value: color,
        });
      } else {
        CustomEditor.removeMark(editor, format);
      }
    },
    [editor]
  );

  const editorTextColors = useMemo(() => {
    return [
      {
        label: t('editor.fontColorDefault'),
        color: '',
      },
      {
        label: t('editor.fontColorGray'),
        color: 'rgb(120, 119, 116)',
      },
      {
        label: t('editor.fontColorBrown'),
        color: 'rgb(159, 107, 83)',
      },
      {
        label: t('editor.fontColorOrange'),
        color: 'rgb(217, 115, 13)',
      },
      {
        label: t('editor.fontColorYellow'),
        color: 'rgb(203, 145, 47)',
      },
      {
        label: t('editor.fontColorGreen'),
        color: 'rgb(68, 131, 97)',
      },
      {
        label: t('editor.fontColorBlue'),
        color: 'rgb(51, 126, 169)',
      },
      {
        label: t('editor.fontColorPurple'),
        color: 'rgb(144, 101, 176)',
      },
      {
        label: t('editor.fontColorPink'),
        color: 'rgb(193, 76, 138)',
      },
      {
        label: t('editor.fontColorRed'),
        color: 'rgb(212, 76, 71)',
      },
    ];
  }, [t]);

  const popoverContent = useMemo(() => {
    return (
      <div className={'flex w-[200px] flex-col gap-3 p-3 bg-surface-primary'}>
        <div className={'flex flex-col gap-2'}>
          <div className={'text-xs text-text-caption'}>{t('editor.textColor')}</div>
          <div className={'flex flex-wrap gap-1.5'}>
            {editorTextColors.map((color, index) => {
              return (
                <Tooltip disableInteractive={true} key={index} title={color.label} placement={'top'}>
                  <div
                    className={'relative flex h-6 w-6 items-center justify-center'}
                    onClick={() => handlePickedColor(EditorMarkFormat.FontColor, color.color)}
                    style={{
                      color: color.color || 'var(--text-title)',
                    }}
                  >
                    <div
                      className={`absolute top-0 left-0 h-full w-full cursor-pointer rounded-200 border opacity-50 hover:opacity-100`}
                      style={{
                        borderColor: activeFontColor === color.color ? color.color : 'var(--background-tertiary)',
                        color: renderColor(color.color) || 'var(--text-title)',
                        opacity: color.color ? undefined : 1,
                      }}
                    />
                    <TextSvg />
                  </div>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </div>
    );
  }, [activeFontColor, editorTextColors, handlePickedColor, t]);

  return (
    <>
      <ActionButton onClick={onClick} tooltip={t('editor.color')}>
        <span ref={wrapperRef}>
          <ColorSvg className="h-5 w-5" />
        </span>
      </ActionButton>
      {toolbarVisible && (
        <Popover
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onMouseUp={(e) => {
            e.stopPropagation();
          }}
          disableRestoreFocus={true}
          disableAutoFocus={true}
          disableEnforceFocus={true}
          open={open}
          onClose={handleClose}
          anchorEl={anchorEl}
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'center',
          }}
          transformOrigin={{
            vertical: -8,
            horizontal: 'center',
          }}
        >
          {popoverContent}
        </Popover>
      )}
    </>
  );
}

export default Color;
