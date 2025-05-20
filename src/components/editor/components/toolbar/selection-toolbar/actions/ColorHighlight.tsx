import { Tooltip } from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { EditorMarkFormat } from '@/application/slate-yjs/types';
import { ReactComponent as HighlightSvg } from '@/assets/icons/text_highlight.svg';
import { Popover } from '@/components/_shared/popover';
import { useSelectionToolbarContext } from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks';
import { ColorEnum, renderColor } from '@/utils/color';

import ActionButton from './ActionButton';



function ColorHighlight() {
    const { t } = useTranslation();
    const { visible: toolbarVisible } = useSelectionToolbarContext();
    const editor = useSlateStatic() as YjsEditor;
    const marks = CustomEditor.getAllMarks(editor);
    const activeBgColor = marks.find((mark) => mark[EditorMarkFormat.BgColor])?.[EditorMarkFormat.BgColor];

    const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
    const open = Boolean(anchorEl);

    const wrapperRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (wrapperRef.current) {
            const svg = wrapperRef.current.querySelector('svg');

            if (svg) {
                const bar = svg.querySelector('[class*="color-bar"]');

                if (bar) {
                    bar.setAttribute('stroke', activeBgColor ? renderColor(activeBgColor) : 'currentColor');
                }
            }
        }
    }, [activeBgColor]);

    useEffect(() => {
        if (!toolbarVisible) {
            setAnchorEl(null);
        }
    }, [toolbarVisible]);

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

    const editorBgColors = useMemo(() => {
        return [
            {
                label: t('editor.backgroundColorDefault'),
                color: '',
            },
            {
                label: t('editor.backgroundColorLime'),
                color: ColorEnum.Lime,
            },
            {
                label: t('editor.backgroundColorAqua'),
                color: ColorEnum.Aqua,
            },
            {
                label: t('editor.backgroundColorOrange'),
                color: ColorEnum.Orange,
            },
            {
                label: t('editor.backgroundColorYellow'),
                color: ColorEnum.Yellow,
            },
            {
                label: t('editor.backgroundColorGreen'),
                color: ColorEnum.Green,
            },
            {
                label: t('editor.backgroundColorBlue'),
                color: ColorEnum.Blue,
            },
            {
                label: t('editor.backgroundColorPurple'),
                color: ColorEnum.Purple,
            },
            {
                label: t('editor.backgroundColorPink'),
                color: ColorEnum.Pink,
            },
            {
                label: t('editor.backgroundColorRed'),
                color: ColorEnum.LightPink,
            },
        ];
    }, [t]);

    const popoverContent = useMemo(() => {
        return (
            <div className={'flex w-[200px] flex-col gap-3 p-3 bg-surface-primary'}>
                <div className={'flex flex-col gap-2'}>
                    <div className={'text-xs text-text-caption'}>{t('editor.backgroundColor')}</div>
                    <div className={'flex flex-wrap gap-1.5'}>
                        {editorBgColors.map((color, index) => {
                            return (
                                <Tooltip disableInteractive={true} key={index} title={color.label} placement={'top'}>
                                    <div
                                        key={index}
                                        className="relative flex h-6 w-6 cursor-pointer items-center justify-center overflow-hidden"
                                        onClick={() => handlePickedColor(EditorMarkFormat.BgColor, color.color)}
                                    >
                                        {activeBgColor === color.color ? (
                                            <>
                                                <div className="absolute inset-0 rounded-200 border-2 border-[#5555E0] bg-transparent pointer-events-none" />
                                                <div
                                                    className="z-[1] w-4 h-4 rounded-100"
                                                    style={{
                                                        backgroundColor: renderColor(color.color),
                                                    }}
                                                />
                                            </>
                                        ) : (
                                            <div
                                                className="w-full h-full rounded-200 border border-background-tertiary"
                                                style={{
                                                    backgroundColor: renderColor(color.color),
                                                }}
                                            />
                                        )}
                                    </div>
                                </Tooltip>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    }, [activeBgColor, editorBgColors, handlePickedColor, t]);

    return (
        <>
            <ActionButton onClick={onClick} tooltip={t('editor.backgroundColor')}>
                <span ref={wrapperRef}>
                    <HighlightSvg className="h-5 w-5" />
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

export default ColorHighlight; 