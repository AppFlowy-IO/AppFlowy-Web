import { useTranslation } from 'react-i18next';
import { Editor, Text, Transforms } from 'slate';
import { useSlate } from 'slate-react';

import { CustomEditor } from '@/application/slate-yjs/command';
import { EditorMarkFormat } from '@/application/slate-yjs/types';
import { ReactComponent as FormulaSvg } from '@/assets/icons/formula.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as StrikeThroughSvg } from '@/assets/icons/strikethrough.svg';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useSelectionToolbarContext } from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks';

import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';
import ActionButton from './ActionButton';
import { useRef, useState } from 'react';
import { MenuButton } from './MenuButton';

const options = [
    {
        icon: <StrikeThroughSvg className="h-5 w-5" />,
        labelKey: 'editor.strikethrough' as const,
        isActive: (editor: Editor) => CustomEditor.isMarkActive(editor, EditorMarkFormat.StrikeThrough),
        onClick: (editor: Editor, setOpen: (v: boolean) => void) => {
            CustomEditor.toggleMark(editor, {
                key: EditorMarkFormat.StrikeThrough,
                value: true,
            });
            setOpen(false);
        },
    },
    {
        icon: <FormulaSvg className="h-5 w-5" />,
        labelKey: 'document.plugins.createInlineMathEquation' as const,
        isActive: (editor: Editor) => CustomEditor.isMarkActive(editor, EditorMarkFormat.Formula),
        onClick: (editor: Editor, setOpen: (v: boolean) => void) => {
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
                    match: (n) => !Editor.isEditor(n) && Text.isText(n) && n.formula !== undefined,
                });

                if (!entry) return;
                const [node, path] = entry;
                const { formula } = node as Text;

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

export default function MoreOptions() {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLButtonElement | null>(null);
    const { t } = useTranslation();
    const editor = useSlate();
    const { forceShow } = useSelectionToolbarContext();

    const { getButtonProps, selectedIndex } = useKeyboardNavigation({
        itemCount: options.length,
        isOpen: open,
        onSelect: (index) => options[index].onClick(editor, setOpen),
        onClose: () => setOpen(false),
    });

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <div>
                    <ActionButton
                        ref={ref}
                        onClick={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            setOpen(true);
                            forceShow(true);
                        }}
                        tooltip={t('toolbar.moreOptions', { defaultValue: 'More options' })}
                    >
                        <MoreIcon className='h-5 w-5' />
                    </ActionButton>
                </div>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-2" align="start" sideOffset={5}>
                <div className="flex flex-col gap-1">
                    {options.map((opt, idx) => (
                        <MenuButton
                            key={opt.labelKey}
                            icon={opt.icon}
                            label={t(opt.labelKey)}
                            isActive={opt.isActive(editor)}
                            onClick={() => opt.onClick(editor, setOpen)}
                            selected={selectedIndex === idx}
                            buttonProps={getButtonProps(idx)}
                        />
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
} 