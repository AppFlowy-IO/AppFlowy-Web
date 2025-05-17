import { Menu, MenuItem, Typography } from '@mui/material';
import { FC, SVGProps, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { getBlockEntry } from '@/application/slate-yjs/utils/editor';
import { type HeadingBlockData, BlockType } from '@/application/types';
import { ReactComponent as BulletedListSvg } from '@/assets/icons/bulleted_list.svg';
import { ReactComponent as Heading1 } from '@/assets/icons/h1.svg';
import { ReactComponent as Heading2 } from '@/assets/icons/h2.svg';
import { ReactComponent as Heading3 } from '@/assets/icons/h3.svg';
import { ReactComponent as NumberedListSvg } from '@/assets/icons/numbered_list.svg';
import { ReactComponent as QuoteSvg } from '@/assets/icons/quote.svg';
import { ReactComponent as ParagraphSvg } from '@/assets/icons/text.svg';
import { ReactComponent as TickIcon } from '@/assets/icons/tick.svg';
import { ReactComponent as ToggleHeading1Icon } from '@/assets/icons/toggle_h1.svg';
import { ReactComponent as ToggleHeading2Icon } from '@/assets/icons/toggle_h2.svg';
import { ReactComponent as ToggleHeading3Icon } from '@/assets/icons/toggle_h3.svg';
import { ReactComponent as ToggleListIcon } from '@/assets/icons/toggle_list.svg';
import { ReactComponent as DownArrow } from '@/assets/icons/triangle_down.svg';

import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';
import { useSelectionToolbarContext } from '../SelectionToolbar.hooks';

import ActionButton from './ActionButton';

type BlockOption = {
    type: 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'quote' | 'bulleted' | 'numbered' | 'toggleHeading1' | 'toggleHeading2' | 'toggleHeading3' | 'toggle';
    icon: FC<SVGProps<SVGSVGElement>>;
    label: string;
    blockType: BlockType;
    data?: any;
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
        label: 'document.slashMenu.name.heading1',
        blockType: BlockType.HeadingBlock,
        data: { level: 1 },
        group: 'text',
    },
    {
        type: 'heading2',
        icon: Heading2,
        label: 'document.slashMenu.name.heading2',
        blockType: BlockType.HeadingBlock,
        data: { level: 2 },
        group: 'text',
    },
    {
        type: 'heading3',
        icon: Heading3,
        label: 'document.slashMenu.name.heading3',
        blockType: BlockType.HeadingBlock,
        data: { level: 3 },
        group: 'text',
    },
    {
        type: 'bulleted',
        icon: BulletedListSvg,
        label: 'toolbar.bulletList',
        blockType: BlockType.BulletedListBlock,
        group: 'list',
    },
    {
        type: 'numbered',
        icon: NumberedListSvg,
        label: 'editor.numberedList',
        blockType: BlockType.NumberedListBlock,
        group: 'list',
    },
    {
        type: 'toggle',
        icon: ToggleListIcon,
        label: 'document.slashMenu.name.toggleList',
        blockType: BlockType.ToggleListBlock,
        group: 'toggle',
    },
    {
        type: 'toggleHeading1',
        icon: ToggleHeading1Icon,
        label: 'document.slashMenu.name.toggleHeading1',
        blockType: BlockType.ToggleListBlock,
        data: { level: 1 },
        group: 'toggle',
    },
    {
        type: 'toggleHeading2',
        icon: ToggleHeading2Icon,
        label: 'document.slashMenu.name.toggleHeading2',
        blockType: BlockType.ToggleListBlock,
        data: { level: 2 },
        group: 'toggle',
    },
    {
        type: 'toggleHeading3',
        icon: ToggleHeading3Icon,
        label: 'document.slashMenu.name.toggleHeading3',
        blockType: BlockType.ToggleListBlock,
        data: { level: 3 },
        group: 'toggle',
    },
    {
        type: 'quote',
        icon: QuoteSvg,
        label: 'toolbar.quote',
        blockType: BlockType.QuoteBlock,
        group: 'other',
    },
];

function TurnInfo() {
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [selectedType, setSelectedType] = useState<BlockOption['type'] | null>(null);
    const ref = useRef<HTMLButtonElement | null>(null);
    const editor = useSlateStatic() as YjsEditor;
    const { t } = useTranslation();
    const { forceShow } = useSelectionToolbarContext();
    const open = Boolean(anchorEl);
    const handleClose = () => {
        setAnchorEl(null);
        forceShow(false);
    };

    // Helper: get current block type and heading level
    let currentType: string | null = null;
    let currentLevel: number | null = null;
    let currentGroup: BlockOption['group'] | null = null;

    try {
        const [node] = getBlockEntry(editor);

        if (node.type === BlockType.Paragraph) {
            currentType = 'paragraph';
            currentGroup = 'text';
        }
        else if (node.type === BlockType.HeadingBlock) {
            currentType = 'heading';
            currentLevel = (node.data as HeadingBlockData).level;
            currentGroup = 'text';
        }
        else if (node.type === BlockType.QuoteBlock) {
            currentType = 'quote';
            currentGroup = 'other';
        }
        else if (node.type === BlockType.BulletedListBlock) {
            currentType = 'bulleted';
            currentGroup = 'list';
        }
        else if (node.type === BlockType.NumberedListBlock) {
            currentType = 'numbered';
            currentGroup = 'list';
        }
        else if (node.type === BlockType.ToggleListBlock) {
            currentType = 'toggle';
            currentGroup = 'toggle';
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

        const option = blockOptions.find(opt => opt.type === selectedType);

        return option ? t(option.label, { defaultValue: option.label }) : 'Text';
    };

    const handleBlockChange = (option: BlockOption) => {
        try {
            const [node] = getBlockEntry(editor);

            if (!node) return;

            if (node.type === option.blockType &&
                (!option.data || (node.type === BlockType.HeadingBlock && (node.data as HeadingBlockData).level === option.data.level))) {
                CustomEditor.turnToBlock(editor, node.blockId as string, BlockType.Paragraph, {});
            } else {
                CustomEditor.turnToBlock(editor, node.blockId as string, option.blockType, option.data || {});
            }

            setSelectedType(option.type);
            handleClose();
        } catch (e) { handleClose(); }
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
        onClose: handleClose,
    });

    function isOptionActive(option: BlockOption, currentType: string | null, currentLevel: number | null) {
        if (!currentType) return false;
        if (option.type === 'paragraph' && currentType === 'paragraph') return true;
        if (option.type.startsWith('heading') && currentType === 'heading') {
            // heading1/2/3 匹配 level
            return option.data && option.data.level === currentLevel;
        }

        if (option.type === 'bulleted' && currentType === 'bulleted') return true;
        if (option.type === 'numbered' && currentType === 'numbered') return true;
        if (option.type === 'toggle' && currentType === 'toggle') return true;
        if (option.type.startsWith('toggleHeading') && currentType === 'toggle' && option.data && option.data.level === currentLevel) return true;
        if (option.type === 'quote' && currentType === 'quote') return true;
        return false;
    }

    return (
        <div className={'flex items-center justify-center'}>
            <ActionButton
                ref={ref}
                onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    setAnchorEl(e.currentTarget as HTMLElement);
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
                    <DownArrow className={'h-5 w-3 text-icon-primary'} />
                </div>
            </ActionButton>
            <Menu
                anchorEl={anchorEl}
                open={open}
                onClose={handleClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                PaperProps={{
                    className: 'bg-[var(--surface-primary)] rounded-[8px]',
                    style: { marginTop: '6px', minWidth: 200, paddingLeft: 'var(--spacing-spacing-m)', paddingRight: 'var(--spacing-spacing-m)' }
                }}
            >
                {suggestionOptions.length > 0 && (
                    <>
                        <Typography
                            className='text-text-secondary'
                            variant="body2"
                            sx={{
                                fontSize: 12,
                                fontWeight: 600,
                                lineHeight: '20px',
                                px: 1.5,
                                py: 0.5,
                                pointerEvents: 'none',
                                userSelect: 'none',
                            }}
                        >
                            {t('toolbar.suggestion', { defaultValue: 'Suggestion' })}
                        </Typography>
                        {suggestionOptions.map((option, index) => (
                            <MenuItem
                                key={option.type}
                                ref={el => getButtonProps(index).ref?.(el as any)}
                                selected={selectedIndex === index}
                                className="text--text-primary"
                                sx={{
                                    ...getButtonProps(index).sx,
                                    fontSize: '14px',
                                    fontStyle: 'normal',
                                    fontWeight: 400,
                                    lineHeight: '20px',
                                    '&.Mui-selected, &.Mui-selected:hover': {
                                        backgroundColor: 'var(--fill-list-hover) !important',
                                        color: 'inherit',
                                    },
                                    '&:hover': {
                                        backgroundColor: 'var(--fill-list-hover)',
                                    },
                                }}
                                onClick={() => handleBlockChange(option)}
                            >
                                <option.icon className="h-5 w-5 mr-2 text-text-primary" />
                                <span className="text-text-primary">
                                    {t(option.label, { defaultValue: option.label })}
                                </span>
                                {isOptionActive(option, currentType, currentLevel) && (
                                    <span className="ml-auto flex items-center">
                                        <TickIcon className="h-5 w-5 text-icon-primary" />
                                    </span>
                                )}
                            </MenuItem>
                        ))}
                    </>
                )}
                <Typography
                    className='text-text-secondary'
                    variant="body2"
                    sx={{
                        fontSize: 12,
                        fontWeight: 600,
                        lineHeight: '20px',
                        px: 1.5,
                        py: 0.5,
                        pointerEvents: 'none',
                        userSelect: 'none',
                    }}
                >
                    {t('document.plugins.optionAction.turnInto', { defaultValue: 'Turn into' })}
                </Typography>
                {turnIntoOptions.map((option, index) => (
                    <MenuItem
                        key={option.type}
                        ref={el => getButtonProps(index + suggestionOptions.length).ref?.(el as any)}
                        selected={selectedIndex === index + suggestionOptions.length}
                        className="text--text-primary"
                        sx={{
                            ...getButtonProps(index + suggestionOptions.length).sx,
                            fontSize: '14px',
                            fontStyle: 'normal',
                            fontWeight: 400,
                            lineHeight: '20px',
                            '&.Mui-selected, &.Mui-selected:hover': {
                                backgroundColor: 'var(--fill-list-hover) !important',
                                color: 'inherit',
                            },
                            '&:hover': {
                                backgroundColor: 'var(--fill-list-hover)',
                            },
                        }}
                        onClick={() => handleBlockChange(option)}
                    >
                        <option.icon className="h-5 w-5 mr-2 text-text-primary" />
                        <span className="text-text-primary">
                            {t(option.label, { defaultValue: option.label })}
                        </span>
                        {isOptionActive(option, currentType, currentLevel) && (
                            <span className="ml-auto flex items-center">
                                <TickIcon className="h-5 w-5 text-icon-primary" />
                            </span>
                        )}
                    </MenuItem>
                ))}
            </Menu>
        </div>
    );
}

export default TurnInfo; 