import { Button } from '@mui/material';
import { PopoverProps } from '@mui/material/Popover';
import { useTranslation } from 'react-i18next';
import { Editor, Text, Transforms } from 'slate';
import { useSlate } from 'slate-react';

import { CustomEditor } from '@/application/slate-yjs/command';
import { EditorMarkFormat } from '@/application/slate-yjs/types';
import { ReactComponent as FormulaSvg } from '@/assets/icons/formula.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as StrikeThroughSvg } from '@/assets/icons/strikethrough.svg';
import Popover from '@/components/_shared/popover/Popover';

import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';

import ActionButton from './ActionButton';
import { useRef, useState } from 'react';



const options = [
    {
        icon: <StrikeThroughSvg className="h-5 w-5" />,
        labelKey: 'editor.strikethrough',
        onClick: (editor: any, setOpen: (v: boolean) => void) => {
            CustomEditor.toggleMark(editor, {
                key: EditorMarkFormat.StrikeThrough,
                value: true,
            });
            setOpen(false);
        },
    },
    {
        icon: <FormulaSvg className="h-5 w-5" />,
        labelKey: 'document.plugins.createInlineMathEquation',
        onClick: (editor: any, setOpen: (v: boolean) => void) => {
            const selection = editor.selection;

            if (!selection) return;
            const isActivated = CustomEditor.isMarkActive(editor, EditorMarkFormat.Formula);

            if (!isActivated) {
                const text = editor.string(selection);

                editor.delete();
                editor.insertText('$');
                const newSelection = editor.selection;

                if (!newSelection) return;
                Transforms.select(editor, {
                    anchor: {
                        path: newSelection.anchor.path,
                        offset: newSelection.anchor.offset - 1,
                    },
                    focus: newSelection.focus,
                });
                CustomEditor.addMark(editor, {
                    key: EditorMarkFormat.Formula,
                    value: text,
                });
            } else {
                const [entry] = editor.nodes({
                    at: selection,
                    match: (n: any) => !Editor.isEditor(n) && Text.isText(n) && (n as any).formula !== undefined,
                });

                if (!entry) return;
                const [node, path] = entry;
                const formula = (node).formula;

                if (!formula) return;
                editor.select(path);
                CustomEditor.removeMark(editor, EditorMarkFormat.Formula);
                editor.delete();
                editor.insertText(formula);
            }

            setOpen(false);
        },
    },
];

const popoverProps: Partial<PopoverProps> = {
    anchorOrigin: {
        vertical: 'bottom',
        horizontal: 'center',
    },
    transformOrigin: {
        vertical: 'top',
        horizontal: 'center',
    },
    slotProps: {
        paper: {
            className: 'bg-[var(--surface-primary)] rounded-[8px]',
            style: { marginTop: '6px' }
        },
    },
};

export default function MoreOptions() {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLButtonElement | null>(null);
    const { t } = useTranslation();
    const editor = useSlate();

    const { getButtonProps, selectedIndex } = useKeyboardNavigation({
        itemCount: options.length,
        isOpen: open,
        onSelect: (index) => options[index].onClick(editor, setOpen),
        onClose: () => setOpen(false),
    });

    return (
        <>
            <ActionButton
                ref={ref}
                onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(true);
                }}
                tooltip={t('toolbar.moreOptions', { defaultValue: 'More options' })}
            >
                <MoreIcon className='h-5 w-5' />
            </ActionButton>
            <Popover
                disableAutoFocus={true}
                disableEnforceFocus={true}
                disableRestoreFocus={true}
                onClose={() => setOpen(false)}
                open={open}
                anchorEl={ref.current}
                {...popoverProps}
            >
                <div className="flex flex-col w-[200px] rounded-[12px]" style={{ padding: 'var(--spacing-spacing-m)' }}>
                    {options.map((opt, idx) => (
                        <Button
                            key={opt.labelKey}
                            {...getButtonProps(idx)}
                            startIcon={opt.icon}
                            color="inherit"
                            onClick={() => opt.onClick(editor, setOpen)}
                            disableRipple
                            className="text-text-primary"
                            sx={{
                                '.MuiButton-startIcon': {
                                    margin: 0,
                                    marginRight: 'var(--spacing-spacing-m)'
                                },
                                padding: '0 var(--spacing-spacing-m)',
                                height: '32px',
                                minHeight: '32px',
                                borderRadius: '8px',
                                justifyContent: 'flex-start',
                                textAlign: 'left',
                                fontSize: '14px',
                                fontStyle: 'normal',
                                fontWeight: 400,
                                lineHeight: '20px',
                                ...(selectedIndex === idx && {
                                    backgroundColor: 'var(--fill-list-hover)'
                                })
                            }}
                        >
                            {t(opt.labelKey as any)}
                        </Button>
                    ))}
                </div>
            </Popover>
        </>
    );
} 