import { FC, SVGProps, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { getBlockEntry } from '@/application/slate-yjs/utils/editor';
import { type HeadingBlockData, BlockType, BlockData } from '@/application/types';
import { ReactComponent as BulletedListSvg } from '@/assets/icons/bulleted_list.svg';
import { ReactComponent as Heading1 } from '@/assets/icons/h1.svg';
import { ReactComponent as Heading2 } from '@/assets/icons/h2.svg';
import { ReactComponent as Heading3 } from '@/assets/icons/h3.svg';
import { ReactComponent as NumberedListSvg } from '@/assets/icons/numbered_list.svg';
import { ReactComponent as QuoteSvg } from '@/assets/icons/quote.svg';
import { ReactComponent as ParagraphSvg } from '@/assets/icons/text.svg';
import { ReactComponent as ToggleHeading1Icon } from '@/assets/icons/toggle_h1.svg';
import { ReactComponent as ToggleHeading2Icon } from '@/assets/icons/toggle_h2.svg';
import { ReactComponent as ToggleHeading3Icon } from '@/assets/icons/toggle_h3.svg';
import { ReactComponent as ToggleListIcon } from '@/assets/icons/toggle_list.svg';
import { ReactComponent as DownArrow } from '@/assets/icons/triangle_down.svg';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useSelectionToolbarContext } from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks';

import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';
import ActionButton from './ActionButton';
import { MenuButton } from './MenuButton';

type BlockOption = {
    type: 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'quote' | 'bulleted' | 'numbered' | 'toggleHeading1' | 'toggleHeading2' | 'toggleHeading3' | 'toggle';
    icon: FC<SVGProps<SVGSVGElement>>;
    label: string;
    blockType: BlockType;
    data?: BlockData | HeadingBlockData;
    group: 'text' | 'list' | 'toggle' | 'other';
};

const blockOptions: BlockOption[] = [
    {
        type: 'paragraph',
        icon: ParagraphSvg,
        label: 'editor.text',
        blockType: BlockType.Paragraph,
        group: 'text',
    },
    {
        type: 'heading1',
        icon: Heading1,
        label: 'toolbar.h1',
        blockType: BlockType.HeadingBlock,
        data: { level: 1 },
        group: 'text',
    },
    {
        type: 'heading2',
        icon: Heading2,
        label: 'toolbar.h2',
        blockType: BlockType.HeadingBlock,
        data: { level: 2 },
        group: 'text',
    },
    {
        type: 'heading3',
        icon: Heading3,
        label: 'toolbar.h3',
        blockType: BlockType.HeadingBlock,
        data: { level: 3 },
        group: 'text',
    },
    {
        type: 'bulleted',
        icon: BulletedListSvg,
        label: 'editor.bulletedListShortForm',
        blockType: BlockType.BulletedListBlock,
        group: 'list',
    },
    {
        type: 'numbered',
        icon: NumberedListSvg,
        label: 'editor.numberedListShortForm',
        blockType: BlockType.NumberedListBlock,
        group: 'list',
    },
    {
        type: 'toggle',
        icon: ToggleListIcon,
        label: 'editor.toggleListShortForm',
        blockType: BlockType.ToggleListBlock,
        group: 'toggle',
    },
    {
        type: 'toggleHeading1',
        icon: ToggleHeading1Icon,
        label: 'editor.toggleHeading1ShortForm',
        blockType: BlockType.ToggleListBlock,
        data: { level: 1 },
        group: 'toggle',
    },
    {
        type: 'toggleHeading2',
        icon: ToggleHeading2Icon,
        label: 'editor.toggleHeading2ShortForm',
        blockType: BlockType.ToggleListBlock,
        data: { level: 2 },
        group: 'toggle',
    },
    {
        type: 'toggleHeading3',
        icon: ToggleHeading3Icon,
        label: 'editor.toggleHeading3ShortForm',
        blockType: BlockType.ToggleListBlock,
        data: { level: 3 },
        group: 'toggle',
    },
    {
        type: 'quote',
        icon: QuoteSvg,
        label: 'editor.quote',
        blockType: BlockType.QuoteBlock,
        group: 'other',
    },
];

function isHeadingBlockData(data: BlockOption['data']): data is HeadingBlockData {
    return !!data && typeof (data as HeadingBlockData).level === 'number';
}

function TurnInfo() {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLButtonElement>(null);
    const editor = useSlateStatic() as YjsEditor;
    const { t } = useTranslation();
    const { visible, forceShow } = useSelectionToolbarContext();

    // Helper: get current block type and heading level
    let currentType: string | null = null;
    let currentLevel: number | null = null;
    let currentGroup: BlockOption['group'] | null = null;

    try {
        const [node] = getBlockEntry(editor);

        switch (node.type) {
            case BlockType.Paragraph:
                currentType = 'paragraph';
                currentGroup = 'text';
                break;
            case BlockType.HeadingBlock:
                currentType = 'heading';
                currentLevel = (node.data as HeadingBlockData).level;
                currentGroup = 'text';
                break;
            case BlockType.QuoteBlock:
                currentType = 'quote';
                currentGroup = 'other';
                break;
            case BlockType.BulletedListBlock:
                currentType = 'bulleted';
                currentGroup = 'list';
                break;
            case BlockType.NumberedListBlock:
                currentType = 'numbered';
                currentGroup = 'list';
                break;
            case BlockType.ToggleListBlock:
                currentType = 'toggle';
                currentGroup = 'toggle';
                break;
        }
    } catch (e) { }

    const getDisplayText = () => {
        if (currentType === 'paragraph') return t('editor.text', { defaultValue: 'Text' });
        if (currentType === 'heading' && currentLevel) {
            return t(`document.slashMenu.name.heading${currentLevel}`, { defaultValue: `Heading ${currentLevel}` });
        }

        if (currentType === 'quote') return t('toolbar.quote', { returnObjects: false, defaultValue: 'Quote' });
        if (currentType === 'bulleted') return t('toolbar.bulletList', { returnObjects: false, defaultValue: 'Bulleted List' });
        if (currentType === 'numbered') return t('toolbar.numberedList', { returnObjects: false, defaultValue: 'Numbered List' });

        return 'Text';
    };

    const handleBlockChange = (option: BlockOption) => {
        try {
            const [node] = getBlockEntry(editor);

            if (!node) return;

            if (node.type === option.blockType &&
                (!option.data || (node.type === BlockType.HeadingBlock && isHeadingBlockData(option.data) && (node.data as HeadingBlockData).level === option.data.level))) {
                CustomEditor.turnToBlock(editor, node.blockId as string, BlockType.Paragraph, {});
            } else {
                CustomEditor.turnToBlock(editor, node.blockId as string, option.blockType, option.data || {});
            }

            setOpen(false);
        } catch (e) { setOpen(false); }
    };

    const getSuggestionOptions = () => {
        if (!currentGroup) return [];

        // Get all options from the same group except the current one
        return blockOptions.filter(option =>
            option.group === currentGroup &&
            (option.type !== currentType &&
                !(currentType === 'heading' && option.type === `heading${currentLevel}`))
        );
    };

    const getTurnIntoOptions = () => {
        const suggestionOptions = getSuggestionOptions();

        // Filter out options that are already in suggestions
        return blockOptions.filter(option =>
            !suggestionOptions.some(suggestion => suggestion.type === option.type)
        );
    };

    const suggestionOptions = getSuggestionOptions();
    const turnIntoOptions = getTurnIntoOptions();

    const { getButtonProps, selectedIndex } = useKeyboardNavigation({
        itemCount: suggestionOptions.length + turnIntoOptions.length,
        isOpen: open,
        onSelect: (index) => {
            const options = [...suggestionOptions, ...turnIntoOptions];

            handleBlockChange(options[index]);
        },
        onClose: () => setOpen(false)
    });

    function isOptionActive(option: BlockOption, currentType: string | null, currentLevel: number | null) {
        if (!currentType) return false;
        if (option.type === 'paragraph' && currentType === 'paragraph') return true;
        if (option.type.startsWith('heading') && currentType === 'heading') {
            return isHeadingBlockData(option.data) && option.data.level === currentLevel;
        }

        if (option.type === 'bulleted' && currentType === 'bulleted') return true;
        if (option.type === 'numbered' && currentType === 'numbered') return true;
        if (option.type === 'toggle' && currentType === 'toggle') return true;
        if (option.type.startsWith('toggleHeading') && currentType === 'toggle' && isHeadingBlockData(option.data) && option.data.level === currentLevel) return true;
        if (option.type === 'quote' && currentType === 'quote') return true;
        return false;
    }

    return (
        <div className={'flex items-center justify-center'}>
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
                            tooltip={getDisplayText()}
                        >
                            <div className={'flex items-center justify-center gap-1 '}>
                                <span
                                    className={'max-w-[120px] truncate text-text-primary'}
                                    style={{
                                        fontSize: 14,
                                        fontStyle: 'normal',
                                        fontWeight: 400,
                                        lineHeight: '20px',
                                    }}
                                >
                                    {getDisplayText()}
                                </span>
                                <DownArrow className={'h-5 w-3 text-icon-tertiary'} />
                            </div>
                        </ActionButton>
                    </div>
                </PopoverTrigger>
                {visible && (
                    <PopoverContent className="w-[200px] p-2" align="start" sideOffset={5}>
                        <div className="flex flex-col gap-1">
                            {suggestionOptions.length > 0 && (
                                <>
                                    <div className="text-xs font-semibold text-text-secondary px-3 py-1 pointer-events-none select-none">
                                        {t('toolbar.suggestions', { defaultValue: 'Suggestions' })}
                                    </div>
                                    {suggestionOptions.map((option, idx) => (
                                        <MenuButton
                                            key={option.type}
                                            icon={<option.icon className="h-5 w-5" />}
                                            label={t(option.label, { defaultValue: option.label })}
                                            isActive={isOptionActive(option, currentType, currentLevel)}
                                            onClick={() => handleBlockChange(option)}
                                            selected={selectedIndex === idx}
                                            buttonProps={getButtonProps(idx)}
                                        />
                                    ))}
                                </>
                            )}
                            <div className="text-xs font-semibold text-text-secondary px-3 py-1 pointer-events-none select-none">
                                {t('toolbar.turnInto', { defaultValue: 'Turn into' })}
                            </div>
                            {turnIntoOptions.map((option, idx) => (
                                <MenuButton
                                    key={option.type}
                                    icon={<option.icon className="h-5 w-5" />}
                                    label={t(option.label, { defaultValue: option.label })}
                                    isActive={isOptionActive(option, currentType, currentLevel)}
                                    onClick={() => handleBlockChange(option)}
                                    selected={selectedIndex === idx + suggestionOptions.length}
                                    buttonProps={getButtonProps(idx + suggestionOptions.length)}
                                />
                            ))}
                        </div>
                    </PopoverContent>
                )}
            </Popover>
        </div>
    );
}

export default TurnInfo; 